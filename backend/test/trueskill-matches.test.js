const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTrueSkillFromMatches } = require('../src/lib/trueskill-matches');

test('computeTrueSkillFromMatches loads and returns an empty result for empty input', async () => {
  const result = await computeTrueSkillFromMatches([], [], new Map(), {});

  assert.deepEqual(result.players, []);
  assert.equal(result.gamesProcessed, 0);
  assert.deepEqual(result.games, []);
  assert.deepEqual(result.tournamentEntryRatings, []);
  assert.deepEqual(result.tournamentExitRatings, []);
});
