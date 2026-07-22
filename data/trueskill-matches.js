// data/trueskill-matches.js
const { Rating, TrueSkill } = require('ts-trueskill');

// Builds a roster lookup keyed by (Year, Captain) ONLY -- not Tournament.
// The draft CSV only ever labels its rows Tournament="Summer" (there's no
// Winter draft data yet), so a Captain's roster is assumed to carry across
// every split/tournament played that same year. If/when Winter drafts get
// added with their own rosters, change this key to also include
// tournament and this function is the only thing that needs to move.
function buildRosterMap(draftRows, identityMap) {
  const resolve = (name) => {
    const identity = identityMap.get(name);
    return identity ? identity.identityKey : name;
  };

  const byTournament = new Map(); // `${year}::${tournament}::${captainKey}` -> Set(playerKey)
  const byYearOnly = new Map();   // `${year}::${captainKey}` -> Set(playerKey)

  for (const row of draftRows) {
    if (!Number.isFinite(row.year) || !row.captain) continue;
    const captainKey = resolve(row.captain);
    const playerKey = row.identityKey || resolve(row.groupVal);
    const tournament = row.tournament || 'Summer'; 

    const tKey = `${row.year}::${tournament}::${captainKey}`;
    if (!byTournament.has(tKey)) byTournament.set(tKey, new Set());
    byTournament.get(tKey).add(playerKey);
    byTournament.get(tKey).add(captainKey);

    const yKey = `${row.year}::${captainKey}`;
    if (!byYearOnly.has(yKey)) byYearOnly.set(yKey, new Set());
    byYearOnly.get(yKey).add(playerKey);
    byYearOnly.get(yKey).add(captainKey);
  }

  return {
    get(year, tournament, captainKey) {
      const tKey = `${year}::${tournament}::${captainKey}`;
      if (byTournament.has(tKey)) return byTournament.get(tKey);
      const yKey = `${year}::${captainKey}`;
      if (byYearOnly.has(yKey)) return byYearOnly.get(yKey);
      return null;
    }
  };
}

module.exports = { buildRosterMap };

// Determines which side won a given match row. Tries an exact string
// match against Team 1 / Team 2 first, then falls back to a
// case-insensitive comparison (covers the casing-only mismatches you
// mentioned, e.g. "Liquid Blade#4th" vs "#4th"). If Result matches
// neither side under either comparison, the game is treated as a draw
// rather than silently dropped or mis-assigned.
function resolveOutcome(m) {
  if (m.result === m.team1) return [0, 1];
  if (m.result === m.team2) return [1, 0];
  const norm = (s) => (s || '').trim().toLowerCase();
  const r = norm(m.result);
  if (r === norm(m.team1)) return [0, 1];
  if (r === norm(m.team2)) return [1, 0];
  return [0, 0]; // draw / unrecognized result string
}

// rows: identity-resolved draft rows (same shape produced elsewhere by
//   resolveIdentities()) -- used only to build rosters, not to rate.
// matches: raw rows from the `matches` table: {year, tournament, team1, team2, result}
// identityMap: same alias map used throughout the app.
function computeTrueSkillFromMatches(matches, draftRows, identityMap, {
  mu = 25,
  sigma = mu / 3,
  beta = sigma / 2,
  tau = sigma / 100,
  drawProbability = 0.1
} = {}) {
  const env = new TrueSkill(mu, sigma, beta, tau, drawProbability);
  const resolve = (name) => {
    const identity = identityMap.get(name);
    return identity ? identity.identityKey : name;
  };
  const displayInfo = (key) => {
    for (const row of draftRows) {
      if ((row.identityKey || resolve(row.groupVal)) === key) {
        return { displayName: row.displayName || row.groupVal, profileUrl: row.profileUrl || null, identified: !!row.identified };
      }
    }
    return { displayName: key, profileUrl: null, identified: false };
  };

  const roster = buildRosterMap(draftRows, identityMap);
  const ratings = new Map();  // identityKey -> Rating
  const history = new Map();  // identityKey -> [{year, tournament, opponent, result, mu, sigma}]

  // Diagnostics: which (year, captain) pairs had no roster on record, so
  // they were played as solo teams -- surface this so you can tell "no
  // draft data yet" apart from "name mismatch to go fix."
  const unresolved = new Map(); // `${year}::${captainRaw}` -> count

  // Chronological order matters (each game updates the running rating),
  // stable sort preserves the CSV's original within-year ordering.
  const ordered = [...matches].sort((a, b) => a.year - b.year);

  for (const m of ordered) {
    const team1Key = resolve(m.team1);
    const team2Key = resolve(m.team2);

    const getRoster = (rawName, key) => {
      const found = roster.get(m.year, m.tournament, key);
      if (found) return [...found];
      unresolved.set(`${m.year}::${m.tournament}::${rawName}`, (unresolved.get(`${m.year}::${m.tournament}::${rawName}`) || 0) + 1);
      return [key]; // solo-team fallback
    };

    const team1Members = getRoster(m.team1, team1Key);
    const team2Members = getRoster(m.team2, team2Key);

    const team1Ratings = team1Members.map((k) => ratings.get(k) || new Rating(mu, sigma));
    const team2Ratings = team2Members.map((k) => ratings.get(k) || new Rating(mu, sigma));

    const ranks = resolveOutcome(m);
    const [updated1, updated2] = env.rate([team1Ratings, team2Ratings], ranks);

    const record = (members, updatedRatings, opponentKey, outcome) => {
      members.forEach((key, i) => {
        ratings.set(key, updatedRatings[i]);
        if (!history.has(key)) history.set(key, []);
        history.get(key).push({
          year: m.year,
          tournament: m.tournament,
          opponent: opponentKey,
          outcome, // 'win' | 'loss' | 'draw'
          mu: round3(updatedRatings[i].mu),
          sigma: round3(updatedRatings[i].sigma)
        });
      });
    };
    const outcome1 = ranks[0] < ranks[1] ? 'win' : ranks[0] > ranks[1] ? 'loss' : 'draw';
    const outcome2 = ranks[1] < ranks[0] ? 'win' : ranks[1] > ranks[0] ? 'loss' : 'draw';
    record(team1Members, updated1, team2Key, outcome1);
    record(team2Members, updated2, team1Key, outcome2);
  }

  const CONSERVATIVE_K = 3;
  const players = [...ratings.entries()].map(([identityKey, rating]) => {
    const info = displayInfo(identityKey);
    const h = history.get(identityKey) || [];
    return {
      identityKey,
      group: info.displayName,
      profileUrl: info.profileUrl,
      identified: info.identified,
      mu: round3(rating.mu),
      sigma: round3(rating.sigma),
      conservativeRating: round3(rating.mu - CONSERVATIVE_K * rating.sigma),
      games: h.length,
      wins: h.filter((x) => x.outcome === 'win').length,
      losses: h.filter((x) => x.outcome === 'loss').length,
      draws: h.filter((x) => x.outcome === 'draw').length,
      history: h
    };
  });
  players.sort((a, b) => b.conservativeRating - a.conservativeRating);

  const unresolvedTeams = [...unresolved.entries()]
    .map(([key, count]) => {
      const [year, tournament, captain] = key.split('::');
      return { year: parseInt(year, 10), tournament, captain, gamesAsSoloTeam: count };
    })
    .sort((a, b) => b.gamesAsSoloTeam - a.gamesAsSoloTeam);

  return {
    params: { mu, sigma, beta, tau, drawProbability, conservativeK: CONSERVATIVE_K },
    gamesProcessed: ordered.length,
    players,
    unresolvedTeams // (year, captain) pairs that had no draft roster on file
  };
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

module.exports = { computeTrueSkillFromMatches, buildRosterMap };