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

test('player history details include canonical identity keys', async () => {
  const identityMap = new Map([
    ['Alpha#NA1', { identityKey: 'alpha', displayName: 'Alpha#NA1' }],
    ['Beta#NA1', { identityKey: 'beta', displayName: 'Beta#NA1' }],
  ]);
  const result = await computeTrueSkillFromMatches(
    [{
      year: 2026,
      tournament: 'Summer',
      team1: 'Alpha#NA1',
      team2: 'Beta#NA1',
      result: 'Alpha#NA1',
      matchOrder: 1,
      rowIndex: 0,
      details: [
        { player: 'Alpha#NA1', role: 'Mid' },
        { player: 'Beta#NA1', role: 'Mid' },
      ],
    }],
    [
      { year: 2026, tournament: 'Summer', captain: 'Alpha#NA1', groupVal: 'Alpha#NA1', identityKey: 'alpha', displayName: 'Alpha#NA1' },
      { year: 2026, tournament: 'Summer', captain: 'Beta#NA1', groupVal: 'Beta#NA1', identityKey: 'beta', displayName: 'Beta#NA1' },
    ],
    identityMap,
  );

  const alpha = result.players.find((player) => player.identityKey === 'alpha');
  assert.deepEqual(alpha.history[0].details.map((detail) => detail.identityKey), ['alpha', 'beta']);
});

test('stage and series metadata does not change per-game TrueSkill results', async () => {
  const matches = [
    { year: 2026, tournament: 'Summer', team1: 'Alpha', team2: 'Beta', result: 'Alpha', matchOrder: 1, rowIndex: 0 },
    { year: 2026, tournament: 'Summer', team1: 'Alpha', team2: 'Beta', result: 'Beta', matchOrder: 2, rowIndex: 1 },
  ];
  const plain = await computeTrueSkillFromMatches(matches, [], new Map());
  const structured = await computeTrueSkillFromMatches(
    matches.map((match, index) => ({
      ...match,
      stageId: 'stage-1',
      stage: { stageName: 'Finals', stageFormat: 'single-elimination', stageOrder: 1 },
      seriesId: 'series-1',
      series: { roundLabel: 'Final', bestOf: 3 },
      gameNumber: index + 1,
    })),
    [],
    new Map(),
  );

  const resultSignature = (result) => ({
    players: result.players.map((player) => ({
      group: player.group,
      games: player.games,
      wins: player.wins,
      losses: player.losses,
      mu: player.mu,
      sigma: player.sigma,
      conservativeRating: player.conservativeRating,
    })),
    games: result.games.map((game) => ({
      winner: game.winner,
      predictedWinProbTeam1: game.predictedWinProbTeam1,
      team1Rating: game.team1.avg,
      team2Rating: game.team2.avg,
    })),
  });
  assert.deepEqual(resultSignature(structured), resultSignature(plain));
  assert.deepEqual(structured.games.map((game) => game.gameNumber), [1, 2]);
});
