const { Rating, TrueSkill } = require("ts-trueskill");
const { buildReverseIdentityLookup } = require("./player-identity");

function buildRosterMap(draftRows, identityMap) {
  const resolve = (name) => {
    const identity = identityMap.get(name);
    return identity ? identity.identityKey : name;
  };

  const byTournament = new Map(); // `${year}::${tournament}::${captainKey}` -> Set(playerKey)
  const byYearOnly = new Map(); // `${year}::${captainKey}` -> Set(playerKey)

  for (const row of draftRows) {
    if (!Number.isFinite(row.year) || !row.captain) continue;
    const captainKey = resolve(row.captain);
    const playerKey = row.identityKey || resolve(row.groupVal);
    const tournament = row.tournament || "Summer";

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
    },
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
  const norm = (s) => (s || "").trim().toLowerCase();
  const r = norm(m.result);
  if (r === norm(m.team1)) return [0, 1];
  if (r === norm(m.team2)) return [1, 0];
  return [0, 0]; // draw / unrecognized result string
}

// rows: identity-resolved draft rows (same shape produced elsewhere by
//   resolveIdentities()) -- used only to build rosters, not to rate.
// matches: raw rows from the `matches` table: {year, tournament, team1, team2, result}
// identityMap: same alias map used throughout the app.
function computeTrueSkillFromMatches(
  matches,
  draftRows,
  identityMap,
  {
    mu = 1000,
    sigma = mu / 3,
    beta = mu / 4,
    tau = sigma / 50,
    drawProbability = 0,
    conservativeK = 1,
  } = {},
) {
  const env = new TrueSkill(mu, sigma, beta, tau, drawProbability);
  const resolve = (name) => {
    const identity = identityMap.get(name);
    return identity ? identity.identityKey : name;
  };

  const reverseIdentity = buildReverseIdentityLookup(identityMap);

  const displayInfo = (key) => {
    if (reverseIdentity.has(key)) return reverseIdentity.get(key);
    for (const row of draftRows) {
      if ((row.identityKey || resolve(row.groupVal)) === key) {
        return {
          displayName: row.displayName || row.groupVal,
          profileUrl: row.profileUrl || null,
          identified: !!row.identified,
        };
      }
    }
    return { displayName: key, profileUrl: null, identified: false };
  };

  const roster = buildRosterMap(draftRows, identityMap);
  const tournamentEntryRating = new Map();
  const tournamentExitRating = new Map();
  const ratings = new Map(); // identityKey -> Rating
  const history = new Map(); // identityKey -> [{year, tournament, opponent, result, mu, sigma, conservativeRating, conservativeK}]
  const games = [];

  // Diagnostics: which (year, captain) pairs had no roster on record, so
  // they were played as solo teams -- surface this so you can tell "no
  // draft data yet" apart from "name mismatch to go fix."
  const unresolved = new Map(); // `${year}::${captainRaw}` -> count

  // Chronological order matters (each game updates the running rating).
  // We sort by year first, then by season with Winter before Summer, and then matchOrder
  const ordered = [...matches].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;

    const seasonRank = (value) => {
      const normalized = String(value || "")
        .trim()
        .toLowerCase();
      if (normalized === "winter") return 0;
      if (normalized === "summer") return 1;
      return 2;
    };
    const seasonDiff = seasonRank(a.tournament) - seasonRank(b.tournament);
    if (seasonDiff !== 0) return seasonDiff;

    // match_order is authoritative and always present. Ties (same
    // match_order) represent genuinely simultaneous games -- since no
    // player appears in two same-match_order games, the relative order
    // WITHIN a tie can't affect any player's rating (nothing links them).
    // csv_row_index is used only as a deterministic tiebreak so repeated
    // runs produce identical output, not because it reflects real time.
    if (a.matchOrder !== b.matchOrder) return a.matchOrder - b.matchOrder;
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
        unresolved.set(
          `${m.year}::${m.tournament}::${rawName}`,
          (unresolved.get(`${m.year}::${m.tournament}::${rawName}`) || 0) + 1,
        );
      }
      return members;
    };
    const team1Members = getRoster(m.team1, team1Key);
    const team2Members = getRoster(m.team2, team2Key);

    const team1Ratings = team1Members.map(
      (k) => ratings.get(k) || new Rating(mu, sigma),
    );
    const team2Ratings = team2Members.map(
      (k) => ratings.get(k) || new Rating(mu, sigma),
    );

    const buildRosterSnapshot = (memberKeys, memberRatings) =>
      memberKeys.map((key, i) => {
        const info = displayInfo(key);
        const r = memberRatings[i];
        return {
          identityKey: key,
          displayName: info.displayName || key,
          mu: round3(r.mu),
          sigma: round3(r.sigma),
          conservativeRating: round3(r.mu - conservativeK * r.sigma),
        };
      });
    const team1Roster = buildRosterSnapshot(team1Members, team1Ratings);
    const team2Roster = buildRosterSnapshot(team2Members, team2Ratings);
    const avgConservative = (roster) =>
      roster.length
        ? round3(
            roster.reduce((sum, m) => sum + m.conservativeRating, 0) /
              roster.length,
          )
        : null;
    const team1Avg = avgConservative(team1Roster);
    const team2Avg = avgConservative(team2Roster);

    const avgMu = (roster) =>
      roster.length
        ? round3(roster.reduce((sum, m) => sum + m.mu, 0) / roster.length)
        : null;
    const team1AvgMu = avgMu(team1Roster);
    const team2AvgMu = avgMu(team2Roster);

    const p1WinsPredicted = predictedWinProbability(
      team1Ratings,
      team2Ratings,
      beta,
    );
    const p2WinsPredicted = 1 - p1WinsPredicted;

    const ranks = resolveOutcome(m);
    const [updated1, updated2] = env.rate([team1Ratings, team2Ratings], ranks);

    const outcome1 =
      ranks[0] < ranks[1] ? "win" : ranks[0] > ranks[1] ? "loss" : "draw";
    const outcome2 =
      ranks[1] < ranks[0] ? "win" : ranks[1] > ranks[0] ? "loss" : "draw";

    const record = (
      members,
      updatedRatings,
      preRatings,
      opponentKey,
      outcome,
      predictedWinProb,
      ownTeam,
      opponentTeam,
    ) => {
      return members.map((key, i) => {
        const pre = preRatings[i];
        const preConservative = round3(pre.mu - conservativeK * pre.sigma);
        ratings.set(key, updatedRatings[i]);
        if (!history.has(key)) history.set(key, []);

        const opponentDisplay =
          displayInfo(opponentKey).displayName || opponentKey;
        const postConservative = round3(
          updatedRatings[i].mu - conservativeK * updatedRatings[i].sigma,
        );

        const entryKey = `${key}::${m.year}::${m.tournament}`;
        if (!tournamentEntryRating.has(entryKey)) {
          tournamentEntryRating.set(entryKey, {
            mu: round3(pre.mu),
            sigma: round3(pre.sigma),
            conservativeRating: preConservative,
          });
        }
        tournamentExitRating.set(entryKey, {
          mu: round3(updatedRatings[i].mu),
          sigma: round3(updatedRatings[i].sigma),
          conservativeRating: postConservative,
        });

        const entry = {
          gameIndex: m.rowIndex ?? m.id ?? 0,
          year: m.year,
          tournament: m.tournament,
          matchStage: m.matchStage || null,
          opponent: opponentDisplay,
          opponentName: opponentDisplay,
          outcome,
          predictedWinProb: round3(predictedWinProb),
          mu: round3(updatedRatings[i].mu),
          sigma: round3(updatedRatings[i].sigma),
          conservativeRating: postConservative,
          ratingChange: round3(postConservative - preConservative),
          ownTeam: {
            name: ownTeam.name,
            roster: ownTeam.roster,
            avgConservativeRating: ownTeam.avg,
            avgMu: ownTeam.avgMu,
          },
          opponentTeam: {
            roster: opponentTeam.roster,
            avgConservativeRating: opponentTeam.avg,
            avgMu: opponentTeam.avgMu,
          },
        };
        history.get(key).push(entry);
        return {
          identityKey: key,
          displayName: displayInfo(key).displayName,
          ratingChange: entry.ratingChange,
        };
      });
    };
    const team1Changes = record(
      team1Members,
      updated1,
      team1Ratings,
      team2Key,
      outcome1,
      p1WinsPredicted,
      {
        name: displayInfo(team1Key).displayName,
        roster: team1Roster,
        avg: team1Avg,
        avgMu: team1AvgMu,
      },
      {
        name: displayInfo(team2Key).displayName,
        roster: team2Roster,
        avg: team2Avg,
        avgMu: team2AvgMu,
      },
    );
    const team2Changes = record(
      team2Members,
      updated2,
      team2Ratings,
      team1Key,
      outcome2,
      p2WinsPredicted,
      {
        name: displayInfo(team2Key).displayName,
        roster: team2Roster,
        avg: team2Avg,
        avgMu: team2AvgMu,
      },
      {
        name: displayInfo(team1Key).displayName,
        roster: team1Roster,
        avg: team1Avg,
        avgMu: team1AvgMu,
      },
    );

    const winner =
      outcome1 === "win" ? "team1" : outcome2 === "win" ? "team2" : "draw";

    games.push({
      year: m.year,
      tournament: m.tournament,
      matchStage: m.matchStage || null,
      csvRowIndex: m.rowIndex,
      team1: {
        key: team1Key,
        name: displayInfo(team1Key).displayName,
        roster: team1Roster,
        avg: team1Avg,
        avgMu: team1AvgMu,
        changes: team1Changes,
      },
      team2: {
        key: team2Key,
        name: displayInfo(team2Key).displayName,
        roster: team2Roster,
        avg: team2Avg,
        avgMu: team2AvgMu,
        changes: team2Changes,
      },
      winner,
      predictedWinProbTeam1: round3(p1WinsPredicted),
    });
  }

  const players = [...ratings.entries()].map(([identityKey, rating]) => {
    const info = displayInfo(identityKey);
    const h = history.get(identityKey) || [];
    const uniqueTournaments = new Set(
      h.map((x) => `${x.year}::${x.tournament}`),
    ).size;
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
      wins: h.filter((x) => x.outcome === "win").length,
      losses: h.filter((x) => x.outcome === "loss").length,
      draws: h.filter((x) => x.outcome === "draw").length,
      latestGameTournament: h.length
        ? `${h[h.length - 1].tournament || ""} ${h[h.length - 1].year || ""}`.trim()
        : null,
      history: h,
    };
  });
  players.sort((a, b) => b.conservativeRating - a.conservativeRating);

  const unresolvedTeams = [...unresolved.entries()]
    .map(([key, count]) => {
      const [year, tournament, captain] = key.split("::");
      return {
        year: parseInt(year, 10),
        tournament,
        captain,
        gamesAsSoloTeam: count,
      };
    })
    .sort((a, b) => b.gamesAsSoloTeam - a.gamesAsSoloTeam);

  const tournamentEntryRatings = [...tournamentEntryRating.entries()].map(
    ([key, val]) => {
      const [identityKey, year, tournament] = key.split("::");
      return { identityKey, year: parseInt(year, 10), tournament, ...val };
    },
  );
  const tournamentExitRatings = [...tournamentExitRating.entries()].map(
    ([key, val]) => {
      const [identityKey, year, tournament] = key.split("::");
      return { identityKey, year: parseInt(year, 10), tournament, ...val };
    },
  );
  return {
    params: { mu, sigma, beta, tau, drawProbability, conservativeK },
    gamesProcessed: ordered.length,
    players,
    unresolvedTeams,
    games,
    tournamentEntryRatings,
    tournamentExitRatings,
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
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  const erf = z >= 0 ? y : -y;

  return 0.5 * (1 + erf);
}

function predictedWinProbability(team1Ratings, team2Ratings, beta) {
  const sumMu = (ratings) => ratings.reduce((a, r) => a + r.mu, 0);
  const sumVar = (ratings) => ratings.reduce((a, r) => a + r.sigma ** 2, 0);

  const deltaMu = sumMu(team1Ratings) - sumMu(team2Ratings);
  const totalPlayers = team1Ratings.length + team2Ratings.length;
  const denom = Math.sqrt(
    sumVar(team1Ratings) + sumVar(team2Ratings) + totalPlayers * beta ** 2,
  );

  return normCdf(deltaMu / denom); // P(team1 wins)
}

module.exports = {
  computeTrueSkillFromMatches,
  buildRosterMap,
  predictedWinProbability,
  round3,
};
