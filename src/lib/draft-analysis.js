// Joins draft picks (Captain/Player/Year/Tournament/Pick Order) against
// each player's rating ENTERING that specific tournament -- not their
// current/final rating, which would be hindsight. This is what makes
// "did this pick age well" answerable at all: we're asking "was this
// player already good at the moment they were drafted," not "did they
// become good later."
function buildEntryRatingLookup(tournamentEntryRatings) {
  const map = new Map(); // `${identityKey}::${year}::${tournament}` -> entry rating info
  for (const r of tournamentEntryRatings) {
    map.set(`${r.identityKey}::${r.year}::${r.tournament}`, r);
  }
  return map;
}

function tournamentHasSignal(group, defaultConservativeRating) {
  return group.some((p) => p.entryConservativeRating !== defaultConservativeRating);
}
// draftRows: identity-resolved rows from getAllRows()+resolveIdentities()
//   (needs identityKey, captain, year, tournament, pickOrder)
// tournamentEntryRatings: from computeTrueSkillFromMatches()'s return value
function computeDraftIQ(draftRows, tournamentEntryRatings, defaultConservativeRating) {
  const entryLookup = buildEntryRatingLookup(tournamentEntryRatings);
  const byTournament = new Map();

  for (const row of draftRows) {
    if (!Number.isFinite(row.year) || !row.captain || !Number.isFinite(row.pickOrder)) continue;
    const entryKey = `${row.identityKey}::${row.year}::${row.tournament}`;
    const entry = entryLookup.get(entryKey);
    if (!entry) continue;

    const groupKey = `${row.year}::${row.tournament}`;
    if (!byTournament.has(groupKey)) byTournament.set(groupKey, []);
    byTournament.get(groupKey).push({
      identityKey: row.identityKey,
      displayName: row.displayName,
      captain: row.captain,
      pickOrder: row.pickOrder,
      entryConservativeRating: entry.conservativeRating
    });
  }

  const picks = [];
  for (const [groupKey, group] of byTournament.entries()) {
    if (!tournamentHasSignal(group, defaultConservativeRating)) continue; // skip tied-start tournaments entirely

    const [year, tournament] = groupKey.split('::');
    const rankedByRating = [...group].sort((a, b) => b.entryConservativeRating - a.entryConservativeRating);
    const entryRankByKey = new Map(rankedByRating.map((p, i) => [p.identityKey, i + 1]));

    for (const pick of group) {
      const entryRank = entryRankByKey.get(pick.identityKey);
      picks.push({
        ...pick,
        year: parseInt(year, 10),
        tournament,
        entryRank,
        value:  pick.pickOrder - entryRank
      });
    }
  }

  // Aggregate per captain: average value across every pick they've ever
  // made. This is "Draft IQ" -- consistently positive means a captain
  // reliably identifies undervalued players; consistently negative means
  // they tend to reach.
  const byCaptain = new Map();
  for (const pick of picks) {
    if (!byCaptain.has(pick.captain)) byCaptain.set(pick.captain, []);
    byCaptain.get(pick.captain).push(pick);
  }

  const captainDraftIQ = [...byCaptain.entries()].map(([captain, captainPicks]) => {
    const avgValue = captainPicks.reduce((sum, p) => sum + p.value, 0) / captainPicks.length;
    const best = [...captainPicks].sort((a, b) => b.value - a.value)[0];
    const worst = [...captainPicks].sort((a, b) => a.value - b.value)[0];
    return {
      captain,
      picksEvaluated: captainPicks.length,
      avgDraftValue: round3(avgValue),
      bestPick: best ? { displayName: best.displayName, pickOrder: best.pickOrder, entryRank: best.entryRank, value: best.value } : null,
      worstPick: worst ? { displayName: worst.displayName, pickOrder: worst.pickOrder, entryRank: worst.entryRank, value: worst.value } : null
    };
  });
  captainDraftIQ.sort((a, b) => b.avgDraftValue - a.avgDraftValue);

  return { picks, captainDraftIQ };
}

// Aggregates each drafted team's average entering skill for a tournament,
// and compares it against how that team actually performed in THAT
// tournament's games -- answers "does stacking skill on paper actually
// translate into winning," independent of Draft IQ (a captain could draft
// great value picks and still underperform if team cohesion/matchups
// matter more than raw summed skill).
function computeTeamBalance(draftRows, tournamentEntryRatings, games, identityMap, defaultConservativeRating) {
  const resolve = (name) => {
    const identity = identityMap.get(name);
    return identity ? identity.identityKey : name;
  };
  const entryLookup = buildEntryRatingLookup(tournamentEntryRatings);

  const groupsByTournament = new Map();
  for (const row of draftRows) {
    if (!Number.isFinite(row.year) || !row.captain) continue;
    const entry = entryLookup.get(`${row.identityKey}::${row.year}::${row.tournament}`);
    if (!entry) continue;
    const groupKey = `${row.year}::${row.tournament}`;
    if (!groupsByTournament.has(groupKey)) groupsByTournament.set(groupKey, []);
    groupsByTournament.get(groupKey).push(entry.conservativeRating);
  }
  const tournamentsWithSignal = new Set(
    [...groupsByTournament.entries()]
      .filter(([, ratings]) => ratings.some((r) => r !== defaultConservativeRating))
      .map(([key]) => key)
  );

  const rosterStrength = new Map(); // key -> {members: [{identityKey, displayName, conservativeRating}], displayName}
  const addMember = (year, tournament, captainKey, captainDisplayName, identityKey, displayName) => {
    const entry = entryLookup.get(`${identityKey}::${year}::${tournament}`);
    if (!entry) return;
    const key = `${year}::${tournament}::${captainKey}`;
    if (!rosterStrength.has(key)) rosterStrength.set(key, { members: [], seenKeys: new Set(), displayName: captainDisplayName });
    const s = rosterStrength.get(key);
    if (s.seenKeys.has(identityKey)) return;
    s.seenKeys.add(identityKey);
    s.members.push({ identityKey, displayName, conservativeRating: entry.conservativeRating });
  };

  for (const row of draftRows) {
    if (!Number.isFinite(row.year) || !row.captain) continue;
    if (!tournamentsWithSignal.has(`${row.year}::${row.tournament}`)) continue;
    const captainKey = resolve(row.captain);
    addMember(row.year, row.tournament, captainKey, row.captain, row.identityKey, row.displayName);
    addMember(row.year, row.tournament, captainKey, row.captain, captainKey, row.captain); // captain force-included, same as buildRosterMap
  }

  const performance = new Map();
    // `games` is already walked in strict chronological match_order (that's
    // what the rating engine depends on), so the LAST time a team appears
    // here for a given tournament is, by construction, their final/deepest
    // recorded match that tournament -- no need to hardcode a ranking of
    // stage names (Group Stage < Semis < Finals etc), which would be
    // fragile against however this specific league happens to label things.
    const lastStageByKey = new Map(); // `${year}::${tournament}::${teamKey}` -> matchStage (may be null)

    for (const g of games) {
      for (const [team, outcome] of [
        [g.team1, g.winner === 'team1' ? 'win' : g.winner === 'draw' ? 'draw' : 'loss'],
        [g.team2, g.winner === 'team2' ? 'win' : g.winner === 'draw' ? 'draw' : 'loss']
      ]) {
        const key = `${g.year}::${g.tournament}::${team.key}`;
        if (!performance.has(key)) performance.set(key, { wins: 0, losses: 0, draws: 0, games: 0 });
        const p = performance.get(key);
        p.games += 1;
        if (outcome === 'win') p.wins += 1;
        else if (outcome === 'loss') p.losses += 1;

        lastStageByKey.set(key, g.matchStage || null); // unconditional overwrite -- last one processed wins, by design
      }
    }

    const teams = [...rosterStrength.entries()].map(([key, strength]) => {
      const [year, tournament, captainKey] = key.split('::');
      const perf = performance.get(key);
      const avgEntryRating = round3(strength.members.reduce((s, m) => s + m.conservativeRating, 0) / strength.members.length);
      const winRate = perf && perf.games > 0 ? round3(perf.wins / perf.games) : null;
      return {
        year: parseInt(year, 10),
        tournament,
        captain: strength.displayName,
        roster: strength.members,
        avgEntryRating,
        finalStage: lastStageByKey.get(key) ?? null, // NEW -- replaces Games as the visible column
        games: perf?.games ?? 0, // kept internally for winRate + the match-list dropdown
        wins: perf?.wins ?? 0,
        losses: perf?.losses ?? 0,
        draws: perf?.draws ?? 0,
        winRate
      };
    });
  teams.sort((a, b) => b.avgEntryRating - a.avgEntryRating);
  return teams;
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

module.exports = { computeDraftIQ, computeTeamBalance };