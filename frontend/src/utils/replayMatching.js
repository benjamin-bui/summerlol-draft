// Everything about relating a parsed replay (roflReplay.js) to the matches and
// rosters in the database: picking the match, deciding which replay team is
// which side, pairing replay players with roster slots, and filling the editor
// form. All pure functions -- the UI just calls them.

import { championIconKey } from "./format";
import { foldName, splitRiotId } from "./names";
import { getRoleIndex, suggestTeamRoles } from "./roleAssignment";

export { foldName, splitRiotId };

// ---- names -------------------------------------------------------------------

// OCR reads a name from pixels, so it is close to the real one rather than
// identical: l/I/1 and O/0 get swapped, "ß" comes out as "B" or "g", and so on.
// Fold those together, drop spacing and punctuation, and compare what's left.
export function ocrFold(value) {
  return foldName(value)
    .replace(/ß/g, "b")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/[i1|!]/g, "l")
    .replace(/0/g, "o")
    .replace(/5/g, "s")
    .replace(/8/g, "b");
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[b.length];
}

// True when two names are the same up to OCR slips: equal once folded, or (for
// names long enough to tell) at most one edit in five characters apart.
export function ocrNamesMatch(read, actual) {
  const a = ocrFold(read);
  const b = ocrFold(actual);
  if (!a || !b) return false;
  if (a === b) return true;
  const longest = Math.max(a.length, b.length);
  return longest >= 5 && 1 - editDistance(a, b) / longest >= 0.8;
}

// How well a replay player's identity fits one roster name such as
// "Voidliss#NA1": 3 = same Name#Tag, 2 = same game name (the tag is missing on
// one side, as in older replays), 1.5 = a name read from a screenshot that is
// close to the roster's, 1 = same game name but a different tag, 0 = no
// relation.
function currentNameStrength(replayPlayer, rosterName) {
  if (!replayPlayer.gameName || !rosterName) return 0;
  const roster = splitRiotId(rosterName);
  if (foldName(replayPlayer.gameName) !== foldName(roster.name)) {
    return replayPlayer.ocr && ocrNamesMatch(replayPlayer.gameName, roster.name) ? 1.5 : 0;
  }
  if (!replayPlayer.tagLine || !roster.tag) return 2;
  return foldName(replayPlayer.tagLine) === foldName(roster.tag) ? 3 : 1;
}

// A name the roster player is known to have gone by before (the past-names
// table). Rated just under the same comparison against their current name, so
// a current-name match always wins a tie.
function pastNameStrength(replayPlayer, pastName) {
  const strength = currentNameStrength(replayPlayer, pastName);
  if (strength === 0) return 0;
  if (strength >= 3) return 1.9;
  if (strength >= 2) return 1.8;
  return strength === 1.5 ? 1.4 : 0.9;
}

// (Callers only compare these and test for > 0.) `pastNames` are earlier names
// of the person `rosterName` is today.
export function nameMatchStrength(replayPlayer, rosterName, pastNames = []) {
  return pastNames.reduce(
    (best, past) => Math.max(best, pastNameStrength(replayPlayer, past)),
    currentNameStrength(replayPlayer, rosterName),
  );
}

// A roster slot as the editor's state describes it, rated against a replay player.
const slotStrength = (replayPlayer, slot) =>
  Math.max(
    nameMatchStrength(replayPlayer, slot.displayName, slot.pastNames || []),
    nameMatchStrength(replayPlayer, slot.player),
  );

// ---- champions ---------------------------------------------------------------

const CHAMPION_DISPLAY_ALIASES = { MonkeyKing: "Wukong" };

// Screenshots identify a champion by its icon key (lowercase, no spaces). These
// are the keys whose proper spelling isn't just the key capitalised.
const CHAMPION_KEY_NAMES = {
  aurelionsol: "Aurelion Sol",
  belveth: "Bel'Veth",
  chogath: "Cho'Gath",
  drmundo: "Dr. Mundo",
  jarvaniv: "Jarvan IV",
  kaisa: "Kai'Sa",
  khazix: "Kha'Zix",
  kogmaw: "Kog'Maw",
  ksante: "K'Sante",
  leblanc: "LeBlanc",
  leesin: "Lee Sin",
  masteryi: "Master Yi",
  missfortune: "Miss Fortune",
  monkeyking: "Wukong",
  nunu: "Nunu & Willump",
  reksai: "Rek'Sai",
  renata: "Renata Glasc",
  tahmkench: "Tahm Kench",
  twistedfate: "Twisted Fate",
  velkoz: "Vel'Koz",
  xinzhao: "Xin Zhao",
};

// The replay stores internal ids ("MissFortune", "MonkeyKing"); a screenshot
// gives icon keys ("missfortune"). Prefer the spelling already used in the
// data; otherwise make a readable one.
export function championDisplayName(internalName, knownSpellings = []) {
  const key = championIconKey(internalName);
  const known = knownSpellings.find((name) => championIconKey(name) === key);
  if (known) return known;
  if (CHAMPION_DISPLAY_ALIASES[internalName]) return CHAMPION_DISPLAY_ALIASES[internalName];
  const text = String(internalName);
  if (text === text.toLowerCase()) {
    return CHAMPION_KEY_NAMES[key] || text.charAt(0).toUpperCase() + text.slice(1);
  }
  return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
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

// Everyone who appears in a match's two rosters (captains included), with any
// past names the server knows for them.
function matchMembers(row) {
  const roster = (team) => (team?.roster || []).map((member) => ({ displayName: member.displayName, pastNames: member.pastNames || [] }));
  return [{ displayName: row.team1, pastNames: [] }, { displayName: row.team2, pastNames: [] }, ...roster(row._team1Roster), ...roster(row._team2Roster)];
}

// Matches whose rosters contain many of the replay's players, best first.
// Only worth offering when most of the ten are found.
export function suggestMatches(replay, rows, { minPlayers = 6 } = {}) {
  return rows
    .map((row) => {
      const members = matchMembers(row);
      const score = replay.players.filter((p) =>
        members.some((member) => nameMatchStrength(p, member.displayName, member.pastNames) > 0),
      ).length;
      return { row, score };
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
      const strength = slotStrength(player, slot);
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
    playersOf(replayTeam).filter((p) => slotsOf(teamIndex).some((s) => slotStrength(p, s) > 0)).length;

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

// ---- roles ---------------------------------------------------------------------------

const parseKey = (key) => key.split(":").map(Number);

// The role for every roster slot the replay fills, as { slotKey: role | "" }.
// A role is taken, in order, from: `keep` (what the editor already chose, which
// may be an explicit blank), the replay itself, the role already on the form's
// slot, and finally a guess from the team's history and champions (see
// roleAssignment.js). Roles that are already settled are never handed to a
// second player of the same team.
//   keep           { slotKey: role } choices to leave alone
//   ignoreExisting true to disregard the form's own roles for the filled slots
//                  (the "re-assign roles" button), but not the replay's
export function resolveRoles(form, replay, assign, { roleHistory = [], currentMatchKey = null, keep = {}, ignoreExisting = false } = {}) {
  const byKey = new Map();
  for (const player of replay.players) {
    if (assign[player.index]) byKey.set(assign[player.index], player);
  }
  const roles = {};
  let index = null;
  form.teams.forEach((team, teamIndex) => {
    const taken = [];
    const open = [];
    team.players.forEach((slot, playerIndex) => {
      const key = slotKey(teamIndex, playerIndex);
      const player = byKey.get(key);
      if (!player) {
        if (slot.role) taken.push(slot.role);
        return;
      }
      if (key in keep) {
        roles[key] = keep[key] || "";
        if (roles[key]) taken.push(roles[key]);
        return;
      }
      const settled = player.role || (ignoreExisting ? "" : slot.role) || "";
      if (settled) {
        roles[key] = settled;
        taken.push(settled);
      } else {
        open.push({ key, slot, player });
      }
    });
    if (!open.length) return;

    // A screenshot lists each team in scoreboard order; `position` lets the
    // guesser notice when that order is the role order.
    const scoreboard = replay.source === "screenshot" ? replay.players.filter((p) => p.team === open[0].player.team).map((p) => p.index) : null;
    const members = open.map(({ key, slot, player }) => ({
      id: key,
      position: scoreboard ? scoreboard.indexOf(player.index) : undefined,
      champion: player.champion,
      names: [
        slot.player,
        slot.displayName,
        player.riotId,
        player.gameName && player.tagLine ? `${player.gameName}#${player.tagLine}` : null,
        player.gameName,
        ...(slot.pastNames || []),
      ].filter(Boolean),
    }));
    index ||= getRoleIndex(roleHistory, currentMatchKey);
    const guesses = suggestTeamRoles(index, members, { taken });
    for (const { key } of open) roles[key] = guesses[key] || "";
  });
  return roles;
}

// ---- filling the form -----------------------------------------------------------------

// Fills the form's roster slots from the replay, per `assign`
// ({ replayPlayerIndex: slotKey | null }). Everything else is left untouched.
// `options.roles` ({ slotKey: role }, from resolveRoles) fixes the roles to
// use; without it they are worked out here.
export function applyReplayToForm(form, replay, assign, knownChampions = [], roleHistory = [], currentMatchKey = null, options = {}) {
  const byKey = new Map();
  for (const player of replay.players) {
    if (assign[player.index]) byKey.set(assign[player.index], player);
  }
  const roles = options.roles || resolveRoles(form, replay, assign, { roleHistory, currentMatchKey });
  return {
    ...form,
    teams: form.teams.map((team, teamIndex) => ({
      ...team,
      players: team.players.map((slot, playerIndex) => {
        const key = slotKey(teamIndex, playerIndex);
        const player = byKey.get(key);
        if (!player) return slot;
        const stat = (value) => (value === null ? "" : String(value));
        return {
          ...slot,
          champion: championDisplayName(player.champion, knownChampions),
          kills: stat(player.kills),
          deaths: stat(player.deaths),
          assists: stat(player.assists),
          role: roles[key] ?? slot.role ?? "",
        };
      }),
    })),
  };
}

// Redoes an import after the editor changed something about it (swapped teams,
// re-assigned a player, corrected a read value) WITHOUT losing what they typed
// into the rest of the form: the bans and match result stay as they are now, and
// so do the roster slots no import touches -- before or after this change.
//   current     the form as it is on screen
//   base        the form as it was before any import
//   previous    { slotKey: replayPlayerIndex } as it was before this change
export function reapplyReplay(current, base, replay, assign, previous, knownChampions, options = {}) {
  const fresh = applyReplayToForm(base, replay, assign, knownChampions, options.roleHistory, options.currentMatchKey, { roles: options.roles });
  const touched = new Set([...Object.values(assign), ...Object.values(previous || {})].filter(Boolean));
  return {
    ...fresh,
    resultSide: current.resultSide,
    bans: current.bans,
    teams: fresh.teams.map((team, teamIndex) => ({
      ...team,
      players: team.players.map((slot, playerIndex) =>
        touched.has(slotKey(teamIndex, playerIndex)) ? slot : current.teams[teamIndex].players[playerIndex],
      ),
    })),
  };
}

// ---- remembering old names ---------------------------------------------------------------

// Replay players the editor has matched to a roster slot whose name doesn't
// match theirs -- someone who has changed their Riot ID, or plays on an alt. The
// name that was read is worth keeping as a past name of that roster player (so
// the next import, and the player search, can find them under it).
//   confirmed  { replayPlayerIndex: slotKey } assignments the editor made or
//              approved by hand; a guess the importer made itself is only
//              offered, not assumed (`confirmed: false`).
export function pastNameCandidates(replay, plan, state, confirmed = {}) {
  const candidates = [];
  for (const player of replay.players) {
    const key = plan.assign[player.index];
    const read = String(player.gameName ?? "").trim();
    if (!key || !read) continue;
    const [side, slotIndex] = parseKey(key);
    const slot = state.teams[side]?.players[slotIndex];
    if (!slot || slotStrength(player, slot) > 0) continue; // already the same name (or a known past one)
    candidates.push({
      index: player.index,
      key,
      name: read,
      tag: player.tagLine ? String(player.tagLine).trim() : null,
      slotPlayer: slot.player,
      slotName: slot.displayName,
      confirmed: confirmed[player.index] === key,
    });
  }
  return candidates;
}
