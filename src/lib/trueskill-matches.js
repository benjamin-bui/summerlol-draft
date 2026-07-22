const { Rating, TrueSkill } = require('ts-trueskill');

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
  mu = 1000,
  sigma = mu / 3,
  beta = mu / 4,
  tau = sigma / 50,
  drawProbability = 0,
  conservativeK = 1
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
  const history = new Map();  // identityKey -> [{year, tournament, opponent, result, mu, sigma, conservativeRating, conservativeK}]

  // Diagnostics: which (year, captain) pairs had no roster on record, so
  // they were played as solo teams -- surface this so you can tell "no
  // draft data yet" apart from "name mismatch to go fix."
  const unresolved = new Map(); // `${year}::${captainRaw}` -> count

  // Chronological order matters (each game updates the running rating).
  // We sort by year first, then by season with Summer before Winter,
  // and finally preserve the original row order (earliest first) within
  // the same year/season bucket.
  const ordered = [...matches].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;

    const seasonRank = (value) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized === 'winter') return 0;
      if (normalized === 'summer') return 1;
      return 2;
    };
    const seasonDiff = seasonRank(a.tournament) - seasonRank(b.tournament);
    if (seasonDiff !== 0) return seasonDiff;

    // Top of file = later in time, bottom = earlier -- so a LARGER
    // csv_row_index (further down the file) is chronologically OLDER and
    // should be processed first. This is the reverse of a naive "row order =
  // chronological order" assumption, which is what the bug above was.
  return (b.rowIndex ?? 0) - (a.rowIndex ?? 0);
});

  for (const m of ordered) {
    const team1Key = resolve(m.team1);
    const team2Key = resolve(m.team2);

    const getRoster = (rawName, key) => {
      const found = roster.get(m.year, m.tournament, key);
      const members = found ? [...found] : [];
      // Defensive: the captain (== key, since key is the resolved team1Key/
      // team2Key) must always be present, regardless of whether the roster
      // Set already had them via buildRosterMap's own .add(captainKey) call.
      // This guards against any downstream rebuild of the member list ever
      // silently dropping them again.
      if (!members.includes(key)) members.push(key);
      if (!found) {
        unresolved.set(`${m.year}::${m.tournament}::${rawName}`, (unresolved.get(`${m.year}::${m.tournament}::${rawName}`) || 0) + 1);
      }
      return members;
    };
    const team1Members = getRoster(m.team1, team1Key);
    const team2Members = getRoster(m.team2, team2Key);

    const team1Ratings = team1Members.map((k) => ratings.get(k) || new Rating(mu, sigma));
    const team2Ratings = team2Members.map((k) => ratings.get(k) || new Rating(mu, sigma));
    
    const buildRosterSnapshot = (memberKeys, memberRatings) =>
      memberKeys.map((key, i) => {
        const info = displayInfo(key);
        const r = memberRatings[i];
        return {
          identityKey: key,
          displayName: info.displayName || key,
          mu: round3(r.mu),
          sigma: round3(r.sigma),
          conservativeRating: round3(r.mu - conservativeK * r.sigma)
        };
      });
    const team1Roster = buildRosterSnapshot(team1Members, team1Ratings);
    const team2Roster = buildRosterSnapshot(team2Members, team2Ratings);
    const avgConservative = (roster) => roster.length
      ? round3(roster.reduce((sum, m) => sum + m.conservativeRating, 0) / roster.length)
      : null;
    const team1Avg = avgConservative(team1Roster);
    const team2Avg = avgConservative(team2Roster);

    const avgMu = (roster)  => roster.length
      ? round3(roster.reduce((sum, m) => sum + m.mu, 0) / roster.length)
      : null;
    const team1AvgMu = avgMu(team1Roster);
    const team2AvgMu = avgMu(team2Roster);

    const p1WinsPredicted = predictedWinProbability(team1Ratings, team2Ratings, beta);
    const p2WinsPredicted = 1 - p1WinsPredicted;

    const ranks = resolveOutcome(m);
    const [updated1, updated2] = env.rate([team1Ratings, team2Ratings], ranks);

    const outcome1 = ranks[0] < ranks[1] ? 'win' : ranks[0] > ranks[1] ? 'loss' : 'draw';
    const outcome2 = ranks[1] < ranks[0] ? 'win' : ranks[1] > ranks[0] ? 'loss' : 'draw';

    const record = (members, updatedRatings, opponentKey, outcome, predictedWinProb, ownTeam, opponentTeam) => {
      members.forEach((key, i) => {
        ratings.set(key, updatedRatings[i]);
        if (!history.has(key)) history.set(key, []);
        const opponentDisplay = displayInfo(opponentKey).displayName || opponentKey;
        history.get(key).push({
          gameIndex: m.rowIndex ?? m.id ?? 0,
          year: m.year,
          tournament: m.tournament,
          opponent: opponentDisplay,
          opponentName: opponentDisplay,
          outcome, // 'win' | 'loss' | 'draw'
          predictedWinProb: round3(predictedWinProb),
          mu: round3(updatedRatings[i].mu),
          sigma: round3(updatedRatings[i].sigma),
          conservativeRating: round3(updatedRatings[i].mu - conservativeK * updatedRatings[i].sigma),
          ownTeam: { roster: ownTeam.roster, avgConservativeRating: ownTeam.avg, avgMu: ownTeam.avgMu },
          opponentTeam: { roster: opponentTeam.roster, avgConservativeRating: opponentTeam.avg, avgMu: opponentTeam.avgMu}
        });
      });
    };
    record(team1Members, updated1, team2Key, outcome1, p1WinsPredicted, 
      { roster: team1Roster, avg: team1Avg, avgMu: team1AvgMu }, { roster: team2Roster, avg: team2Avg, avgMu: team2AvgMu });
    record(team2Members, updated2, team1Key, outcome2, p2WinsPredicted, 
      { roster: team2Roster, avg: team2Avg, avgMu: team2AvgMu}, { roster: team1Roster, avg: team1Avg, avgMu: team1AvgMu });
  }

  const players = [...ratings.entries()].map(([identityKey, rating]) => {
    const info = displayInfo(identityKey);
    const h = history.get(identityKey) || [];
    const uniqueTournaments = new Set(h.map((x) => `${x.year}::${x.tournament}`)).size;
    return {
      identityKey,
      group: info.displayName,
      profileUrl: info.profileUrl,
      identified: info.identified,
      mu: round3(rating.mu),
      sigma: round3(rating.sigma),
      conservativeRating: round3(rating.mu - conservativeK * rating.sigma),
      conservativeK,
      games: h.length,
      tournaments: uniqueTournaments,
      wins: h.filter((x) => x.outcome === 'win').length,
      losses: h.filter((x) => x.outcome === 'loss').length,
      draws: h.filter((x) => x.outcome === 'draw').length,
      latestGameTournament: h.length ? `${h[h.length - 1].tournament || ''} ${h[h.length - 1].year || ''}`.trim() : null,
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
    params: { mu, sigma, beta, tau, drawProbability, conservativeK },
    gamesProcessed: ordered.length,
    players,
    unresolvedTeams // (year, captain) pairs that had no draft roster on file
  };
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}
// Standard TrueSkill approximation for P(team1 beats team2), given each
// side's pre-game ratings: treats team performance as the sum of member
// performances (mu summed, variance summed), each player contributing an
// extra beta^2 of performance variance (the "how noisy is one performance"
// term), then reads off a normal CDF -- this is the same math the FAQ/
// standard writeups for TrueSkill use for pairwise win-probability.
function normCdf(x) {
  // Scale the z-score for the error function
  const z = x / Math.SQRT2;
  
  // Abramowitz-Stegun erf approximation, accurate to ~1e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  const erf = z >= 0 ? y : -y;
  
  return 0.5 * (1 + erf);
}

function predictedWinProbability(team1Ratings, team2Ratings, beta) {
  const sumMu = (ratings) => ratings.reduce((a, r) => a + r.mu, 0);
  const sumVar = (ratings) => ratings.reduce((a, r) => a + r.sigma ** 2, 0);

  const deltaMu = sumMu(team1Ratings) - sumMu(team2Ratings);
  const totalPlayers = team1Ratings.length + team2Ratings.length;
  const denom = Math.sqrt(sumVar(team1Ratings) + sumVar(team2Ratings) + totalPlayers * beta ** 2);

  return normCdf(deltaMu / denom); // P(team1 wins)
}


module.exports = { computeTrueSkillFromMatches, buildRosterMap, predictedWinProbability };