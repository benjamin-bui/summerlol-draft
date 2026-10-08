const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeChampionDiversityDistribution,
} = require("../src/lib/trueskill-funfacts");

// A player whose history has one game per entry of `champions` (null = no
// champion on record for that game).
function player(identityKey, champions) {
  return {
    identityKey,
    history: champions.map((c) => ({
      playerDetails: c ? [{ champion: c }] : [],
    })),
  };
}

test("diversity distribution: Gini-Simpson per player, sorted ascending", () => {
  const one = Array(10).fill("Ahri"); // one-trick -> 0
  const even = [
    ...Array(5).fill("Ahri"),
    ...Array(5).fill("Zed"),
  ]; // 1 - (0.25 + 0.25) = 0.5
  const { players, minGames } = computeChampionDiversityDistribution([
    player("even", even),
    player("oneTrick", one),
  ]);
  assert.equal(minGames, 10);
  assert.deepEqual(
    players.map((p) => [p.key, p.games, p.diversity]),
    [
      ["oneTrick", 10, 0],
      ["even", 10, 0.5],
    ],
  );
});

test("diversity distribution: players under the minimum are left out, and games without a champion don't count", () => {
  const { players } = computeChampionDiversityDistribution([
    player("few", Array(9).fill("Ahri")),
    player("sparse", [...Array(9).fill("Ahri"), null, null, null]),
    player("enough", [...Array(10).fill("Ahri"), null]),
  ]);
  assert.deepEqual(
    players.map((p) => [p.key, p.games]),
    [["enough", 10]],
  );
});

test("diversity distribution: minGames is configurable", () => {
  const { players } = computeChampionDiversityDistribution(
    [player("a", ["Ahri", "Zed", "Lux"])],
    { minGames: 3 },
  );
  assert.equal(players.length, 1);
  assert.equal(players[0].diversity, 0.6667);
});
