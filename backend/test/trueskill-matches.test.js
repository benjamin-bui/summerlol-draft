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

test('computeTrueSkillFromMatches rates both sides and normalizes the winner label', async () => {
  const result = await computeTrueSkillFromMatches(
    [
      {
        year: 2026,
        tournament: 'Summer',
        team1: 'Alpha',
        team2: 'Beta',
        result: ' alpha ',
        matchOrder: 1,
        rowIndex: 0,
      },
    ],
    [],
    new Map(),
  );

  assert.equal(result.gamesProcessed, 1);
  assert.equal(result.games[0].winner, 'team1');
  assert.ok(result.games[0].predictedWinProbTeam1 >= 0);
  assert.ok(result.games[0].predictedWinProbTeam1 <= 1);

  const alpha = result.players.find((player) => player.group === 'Alpha');
  const beta = result.players.find((player) => player.group === 'Beta');
  assert.ok(alpha);
  assert.ok(beta);
  assert.equal(alpha.games, 1);
  assert.equal(alpha.wins, 1);
  assert.equal(alpha.history[0].outcome, 'win');
  assert.equal(alpha.history[0].opponent, 'Beta');
  assert.equal(beta.games, 1);
  assert.equal(beta.losses, 1);
  assert.equal(beta.history[0].outcome, 'loss');
  assert.equal(beta.history[0].opponent, 'Alpha');
});
