// Matches loosely against BOTH the resolved display name and the raw
// identityKey -- a pasted roster might use the exact in-game name (which
// could still be an unresolved identityKey if that player was never matched
// to a Riot account) or the resolved display name. Case and surrounding
// whitespace are ignored; this is intentionally an EXACT match otherwise (no
// partial/fuzzy matching), since a substring match risks silently pulling in
// the wrong player on a short name.
export function buildNameMatcher(names) {
  const normalized = new Set(names.map((n) => n.trim().toLowerCase()));
  const bareNameOf = (s) => {
    const idx = s.lastIndexOf("#");
    return (idx === -1 ? s : s.slice(0, idx)).trim().toLowerCase();
  };
  return {
    matches(player) {
      const candidates = [player.group, player.identityKey].filter(Boolean);
      return candidates.some((c) => normalized.has(c.trim().toLowerCase()) || normalized.has(bareNameOf(c)));
    },
    checkCoverage(players) {
      const matchedNames = new Set();
      players.forEach((p) => {
        [p.group, p.identityKey].filter(Boolean).forEach((s) => {
          const norm = s.trim().toLowerCase();
          if (normalized.has(norm)) matchedNames.add(norm);
        });
      });
      const unmatched = [...normalized].filter((n) => !matchedNames.has(n));
      return { matchedCount: matchedNames.size, totalCount: normalized.size, unmatched };
    },
  };
}

// Everyone (captains + players) with at least one recorded game that
// year+tournament.
export function namesForPastDraft(players, year, tournament) {
  const names = new Set();
  (players || []).forEach((p) => {
    const played = (p.history || []).some((h) => String(h.year) === String(year) && h.tournament === tournament);
    if (played) names.add(p.group);
  });
  return [...names];
}

export function namesForPastDraftCaptains(players, year, tournament) {
  const captainNames = new Set();
  (players || []).forEach((p) => {
    (p.history || []).forEach((h) => {
      if (String(h.year) === String(year) && h.tournament === tournament && h.ownTeam?.name) {
        captainNames.add(h.ownTeam.name);
      }
    });
  });
  return [...captainNames];
}

// Matches typed text against a given pool (case/tag-tolerant); falls back to
// a "manual" stub if nothing in the pool matches, so someone not in a
// filtered list can still be typed in directly -- they just won't carry any
// TrueSkill data.
export function resolvePoolPlayerByName(text, pool) {
  const norm = text.trim().toLowerCase();
  if (!norm) return null;
  const bareOf = (s) => {
    const idx = s.lastIndexOf("#");
    return (idx === -1 ? s : s.slice(0, idx)).trim().toLowerCase();
  };
  const found = pool.find((p) => {
    const g = p.group.trim().toLowerCase();
    return g === norm || bareOf(g) === norm || bareOf(g) === bareOf(norm);
  });
  return found
    ? { ...found, manual: false }
    : {
        identityKey: null,
        group: text.trim(),
        conservativeRating: null,
        mu: null,
        sigma: null,
        soloQueueRank: null,
        flexQueueRank: null,
        wins: null,
        losses: null,
        manual: true,
      };
}
