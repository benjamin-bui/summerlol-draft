function normalizePart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildMatchKey({
  year,
  tournament,
  matchStage,
  matchOrder,
  team1,
  team2,
}) {
  const parts = [
    year,
    tournament || "unknown-tournament",
    matchStage || "unknown-stage",
    matchOrder,
    team1 || "unknown-team-1",
    team2 || "unknown-team-2",
  ].map(normalizePart);
  return `match-${parts.join("-")}`;
}

function buildMatchContextKey({ year, tournament, matchStage, matchOrder }) {
  return [year, tournament || "", matchStage || "", matchOrder]
    .map(normalizePart)
    .join("::");
}

module.exports = { buildMatchKey, buildMatchContextKey, normalizePart };
