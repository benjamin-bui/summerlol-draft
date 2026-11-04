// Guessing which role each player of a team played, for imports that carry no
// role data (a scoreboard screenshot, or a replay of a non-draft game).
//
// The old guess looked at each player on their own ("their most common role in
// past matches") and gave up on ties. This one solves the whole team at once:
//
//   * every player gets a score for each role from two independent clues --
//     what role that person has played before (matched by roster slot, Riot ID,
//     bare name and any past names) and what role that champion is played in
//     (the site's own history, backed by a small built-in table for champions
//     nobody has played yet);
//   * the five players are then given five DIFFERENT roles -- the combination
//     with the best total -- because the server rejects two players in the same
//     role on one team and a real team has exactly one of each;
//   * a role is only filled in when the next best alternative is clearly worse,
//     so a coin-flip stays blank for the editor to decide.
//
// Everything here is pure; replayMatching.js feeds it the editor's data.

import { ROLES, championIconKey } from "./format";
import { foldName, splitRiotId } from "./names";

// ---- tuning --------------------------------------------------------------------

// Pseudo-observations of "no idea" mixed into a player's own history, so one
// past game is a strong hint and ten past games a near-certainty.
const PLAYER_PRIOR_STRENGTH = 1;
// The same for the champion clue; the built-in table counts for this many games.
const CHAMPION_PRIOR_STRENGTH = 2;
// How much the champion clue counts against the player-history clue.
const CHAMPION_WEIGHT = 1;
// Extra credit when this player has played this very champion in this role before.
const PAIR_WEIGHT = 0.8;
// A fill needs the best team layout to beat every layout that changes this
// player's role by at least this much (natural-log units, ~1.35x likelier).
const MIN_MARGIN = 0.3;
// Older games count a little less (players move roles over the years).
const RECENCY_DECAY = 0.85;
// Scoreboard rows are in role order in some lobbies. It is only trusted when
// the clearly-known players already agree with it (see `usesScoreboardOrder`).
const ORDER_BONUS = 1.6;
const ORDER_CONFIDENT_MARGIN = 1;

// ---- what each champion is played as, when the site has no games of it -----------
//
// Best-known roles first (T = Top, J = Jungle, M = Mid, B = Bot, S = Supp). It
// is only a prior: real games recorded on the site outweigh it quickly, and a
// champion missing here (brand-new releases) is simply "no clue".
const LETTER_ROLE = { T: "Top", J: "Jungle", M: "Mid", B: "Bot", S: "Supp" };
const CHAMPION_ROLES = {
  aatrox: "T", ahri: "M", akali: "MT", akshan: "MBT", alistar: "S", ambessa: "TJ", amumu: "JS", anivia: "M",
  annie: "MS", aphelios: "B", ashe: "BS", aurelionsol: "M", aurora: "MT", azir: "M", bard: "S", belveth: "J",
  blitzcrank: "S", brand: "SMJ", braum: "S", briar: "J", caitlyn: "B", camille: "T", cassiopeia: "M",
  chogath: "TM", corki: "MB", darius: "T", diana: "JM", draven: "B", drmundo: "TJ", ekko: "JM", elise: "J",
  evelynn: "J", ezreal: "B", fiddlesticks: "J", fiora: "T", fizz: "M", galio: "MS", gangplank: "T", garen: "T",
  gnar: "T", gragas: "JT", graves: "J", gwen: "T", hecarim: "J", heimerdinger: "TMS", hwei: "MS", illaoi: "T",
  irelia: "TM", ivern: "J", janna: "S", jarvaniv: "J", jax: "TJ", jayce: "TM", jhin: "B", jinx: "B", kaisa: "B",
  kalista: "B", karma: "SM", karthus: "JMB", kassadin: "M", katarina: "M", kayle: "T", kayn: "J", kennen: "T",
  khazix: "J", kindred: "J", kled: "T", kogmaw: "B", ksante: "T", leblanc: "M", leesin: "J", leona: "S",
  lillia: "J", lissandra: "M", lucian: "BM", lulu: "S", lux: "SM", malphite: "TS", malzahar: "M", maokai: "STJ",
  masteryi: "J", mel: "MS", milio: "S", missfortune: "B", monkeyking: "TJ", mordekaiser: "T", morgana: "SJM",
  naafiri: "MJ", nami: "S", nasus: "T", nautilus: "S", neeko: "MS", nidalee: "J", nilah: "B", nocturne: "J",
  nunu: "J", olaf: "JT", orianna: "M", ornn: "T", pantheon: "STM", poppy: "TJS", pyke: "S", qiyana: "MJ",
  quinn: "T", rakan: "S", rammus: "J", reksai: "J", rell: "S", renata: "S", renekton: "T", rengar: "JT",
  riven: "T", rumble: "TM", ryze: "MT", samira: "B", sejuani: "J", senna: "SB", seraphine: "SBM", sett: "TS",
  shaco: "JS", shen: "TS", shyvana: "J", singed: "T", sion: "T", sivir: "B", skarner: "J", smolder: "BM",
  sona: "S", soraka: "S", swain: "SMB", sylas: "MJ", syndra: "M", tahmkench: "ST", taliyah: "JM", talon: "MJ",
  taric: "S", teemo: "T", thresh: "S", tristana: "BM", trundle: "JT", tryndamere: "T", twistedfate: "M",
  twitch: "BJ", udyr: "JT", urgot: "T", varus: "BM", vayne: "BT", veigar: "MS", velkoz: "SM", vex: "M", vi: "J",
  viego: "J", viktor: "M", vladimir: "MT", volibear: "JT", warwick: "J", xayah: "B", xerath: "SM", xinzhao: "J",
  yasuo: "MBT", yone: "MT", yorick: "T", yunara: "B", yuumi: "S", zac: "J", zed: "MJ", zeri: "B", ziggs: "BM",
  zilean: "SM", zoe: "M", zyra: "SJ",
};
const LISTED_WEIGHTS = [1, 0.45, 0.2];
const UNLISTED_WEIGHT = 0.04;

const staticPriors = new Map();
function staticPrior(championKey) {
  if (staticPriors.has(championKey)) return staticPriors.get(championKey);
  const letters = CHAMPION_ROLES[championKey];
  let prior = null;
  if (letters) {
    const raw = Object.fromEntries(ROLES.map((role) => [role, UNLISTED_WEIGHT]));
    [...letters].forEach((letter, i) => {
      raw[LETTER_ROLE[letter]] = LISTED_WEIGHTS[i] ?? UNLISTED_WEIGHT;
    });
    const total = ROLES.reduce((sum, role) => sum + raw[role], 0);
    prior = Object.fromEntries(ROLES.map((role) => [role, raw[role] / total]));
  }
  staticPriors.set(championKey, prior);
  return prior;
}

// ---- reading the site's own history ----------------------------------------------

const bump = (map, key, amount) => map.set(key, (map.get(key) || 0) + amount);
const emptyRecord = () => ({ roles: new Map(), pairs: new Map() });

// Indexes /api/raw-matches rows ({ match_key, year, match_details: [{ player,
// champion, role }] }) by player and by champion. `excludeMatchKey` leaves the
// match being edited out, so its own stored roles can't vouch for themselves.
export function buildRoleIndex(rows, { excludeMatchKey = null } = {}) {
  const byId = new Map();
  const byBare = new Map();
  const champions = new Map();
  const newestYear = Math.max(0, ...rows.map((row) => Number(row.year) || 0));

  for (const row of rows) {
    if (excludeMatchKey && row.match_key === excludeMatchKey) continue;
    const age = newestYear && Number(row.year) ? newestYear - Number(row.year) : 0;
    const weight = RECENCY_DECAY ** Math.max(0, age);
    for (const detail of row.match_details || []) {
      if (!ROLES.includes(detail.role) || !detail.player) continue;
      const championKey = detail.champion ? championIconKey(detail.champion) : null;
      const id = foldName(detail.player);
      const bare = foldName(splitRiotId(detail.player).name);
      for (const [map, key] of [[byId, id], [byBare, bare]]) {
        if (!key) continue;
        if (!map.has(key)) map.set(key, emptyRecord());
        const record = map.get(key);
        bump(record.roles, detail.role, weight);
        if (championKey) {
          if (!record.pairs.has(championKey)) record.pairs.set(championKey, new Map());
          bump(record.pairs.get(championKey), detail.role, weight);
        }
      }
      if (championKey) {
        if (!champions.has(championKey)) champions.set(championKey, new Map());
        bump(champions.get(championKey), detail.role, weight);
      }
    }
  }
  return { byId, byBare, champions };
}

const indexCache = new WeakMap();
// buildRoleIndex, remembered per (rows array, excluded match) -- the editor asks
// again after every edit and the history doesn't change in between.
export function getRoleIndex(rows, excludeMatchKey = null) {
  if (!Array.isArray(rows)) return buildRoleIndex([], {});
  let perRows = indexCache.get(rows);
  if (!perRows) {
    perRows = new Map();
    indexCache.set(rows, perRows);
  }
  const cacheKey = excludeMatchKey ?? "";
  if (!perRows.has(cacheKey)) perRows.set(cacheKey, buildRoleIndex(rows, { excludeMatchKey }));
  return perRows.get(cacheKey);
}

// Everything the history says about one person, from any of the names they go by
// (roster spelling, Riot ID, name as read, past names). Full Riot IDs are
// trusted over bare names, which only count when no full ID has any history.
function recordFor(index, names) {
  const pick = (map, keys) => [...new Set(keys)].map((key) => map.get(key)).filter(Boolean);
  const ids = names.map(foldName).filter(Boolean);
  let hits = pick(index.byId, ids);
  if (!hits.length) hits = pick(index.byBare, names.map((name) => foldName(splitRiotId(name).name)).filter(Boolean));
  const merged = emptyRecord();
  for (const hit of new Set(hits)) {
    for (const [role, count] of hit.roles) bump(merged.roles, role, count);
    for (const [champion, roles] of hit.pairs) {
      if (!merged.pairs.has(champion)) merged.pairs.set(champion, new Map());
      for (const [role, count] of roles) bump(merged.pairs.get(champion), role, count);
    }
  }
  return merged;
}

// ---- scoring ------------------------------------------------------------------------

function scoreMember(index, member) {
  const record = recordFor(index, member.names || []);
  const playerTotal = [...record.roles.values()].reduce((sum, count) => sum + count, 0);
  const championKey = member.champion ? championIconKey(member.champion) : null;
  const seen = (championKey && index.champions.get(championKey)) || new Map();
  const seenTotal = [...seen.values()].reduce((sum, count) => sum + count, 0);
  const prior = championKey ? staticPrior(championKey) : null;
  const pair = (championKey && record.pairs.get(championKey)) || new Map();
  const pairTotal = [...pair.values()].reduce((sum, count) => sum + count, 0);

  const scores = {};
  for (const role of ROLES) {
    const uniform = 1 / ROLES.length;
    const player = ((record.roles.get(role) || 0) + PLAYER_PRIOR_STRENGTH * uniform) / (playerTotal + PLAYER_PRIOR_STRENGTH);
    const base = prior ? prior[role] : uniform;
    const champion = ((seen.get(role) || 0) + CHAMPION_PRIOR_STRENGTH * base) / (seenTotal + CHAMPION_PRIOR_STRENGTH);
    scores[role] = Math.log(player) + CHAMPION_WEIGHT * Math.log(champion) + PAIR_WEIGHT * ((pair.get(role) || 0) / (pairTotal + 1));
  }
  return scores;
}

// Best injective assignment of `members` to `roles` by total score, and for every
// (member, role) the best total among layouts that put that member in that role.
function solve(scores, roles) {
  const count = scores.length;
  const bestWith = scores.map(() => Object.fromEntries(roles.map((role) => [role, -Infinity])));
  let best = { total: -Infinity, picks: [] };
  const picks = [];
  const used = new Set();
  function walk(i, total) {
    if (i === count) {
      picks.forEach((role, member) => {
        if (total > bestWith[member][role]) bestWith[member][role] = total;
      });
      if (total > best.total) best = { total, picks: [...picks] };
      return;
    }
    for (const role of roles) {
      if (used.has(role)) continue;
      used.add(role);
      picks[i] = role;
      walk(i + 1, total + scores[i][role]);
      used.delete(role);
    }
  }
  walk(0, 0);
  return { best, bestWith };
}

function decide(scores, roles) {
  const { best, bestWith } = solve(scores, roles);
  return best.picks.map((role, i) => {
    const alternatives = roles.filter((other) => other !== role).map((other) => bestWith[i][other]);
    const rival = Math.max(-Infinity, ...alternatives);
    return { role, margin: rival === -Infinity ? Infinity : best.total - rival };
  });
}

// Should the scoreboard's row order be trusted as role order? Only when the
// players we are already sure of sit exactly where that order would put them.
function usesScoreboardOrder(members, decisions) {
  const sure = members.map((member, i) => ({ member, decision: decisions[i] })).filter(({ decision }) => decision.margin >= ORDER_CONFIDENT_MARGIN);
  if (sure.length < 3) return false;
  const agreeing = sure.filter(({ member, decision }) => ROLES[member.position] === decision.role).length;
  return agreeing / sure.length >= 0.8;
}

// Guesses roles for one team.
//   members: [{ id, names: [..], champion, position? }] -- `position` is the
//            player's row on the scoreboard (0-4) when that is known.
//   taken:   roles already decided for other players of this team.
// Returns { [id]: role } for every member a role could be confidently given to.
export function suggestTeamRoles(index, members, { taken = [] } = {}) {
  const roles = ROLES.filter((role) => !taken.includes(role));
  const group = members.slice(0, roles.length);
  if (!group.length) return {};

  const scores = group.map((member) => scoreMember(index, member));
  let decisions = decide(scores, roles);
  const ordered = group.every((member) => Number.isInteger(member.position) && member.position >= 0 && member.position < ROLES.length);
  if (ordered && group.length === ROLES.length && usesScoreboardOrder(group, decisions)) {
    group.forEach((member, i) => {
      if (roles.includes(ROLES[member.position])) scores[i][ROLES[member.position]] += ORDER_BONUS;
    });
    decisions = decide(scores, roles);
  }

  const result = {};
  group.forEach((member, i) => {
    if (decisions[i].margin >= MIN_MARGIN) result[member.id] = decisions[i].role;
  });
  return result;
}
