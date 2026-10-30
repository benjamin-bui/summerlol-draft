// Who played for which team in a match. Shared by the CSV ingest
// (ingest-match-details.js) and the in-app match editor so both apply exactly
// the same rule -- a player is on a side if they are that side's captain, or
// were drafted onto that captain's team for the tournament.

function normalizePlayerId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function playersMatch(left, right, identityMap) {
  if (normalizePlayerId(left) === normalizePlayerId(right)) return true;
  const leftIdentity = identityMap.get(String(left || "").trim());
  const rightIdentity = identityMap.get(String(right || "").trim());
  if (
    leftIdentity &&
    rightIdentity &&
    leftIdentity.identityKey === rightIdentity.identityKey
  ) {
    return true;
  }
  return false;
}

// The raw player strings on one team: the captain first, then everyone
// drafted by that captain. `rosterRows` is [{ player, captain }].
function sideMembers(captain, rosterRows, identityMap) {
  const members = [captain];
  for (const rosterRow of rosterRows) {
    if (playersMatch(rosterRow.captain, captain, identityMap)) {
      members.push(rosterRow.player);
    }
  }
  return members;
}

// Which side of `match` (1 = Team 1, 2 = Team 2) a player was on, as a Set of
// the sides they match.
function sidesForPlayer(player, match, rosterRows, identityMap) {
  const sides = new Set();
  [match.team1, match.team2].forEach((captain, i) => {
    const members = sideMembers(captain, rosterRows, identityMap);
    if (members.some((member) => playersMatch(player, member, identityMap))) {
      sides.add(i + 1);
    }
  });
  return sides;
}

module.exports = {
  normalizePlayerId,
  playersMatch,
  sideMembers,
  sidesForPlayer,
};
