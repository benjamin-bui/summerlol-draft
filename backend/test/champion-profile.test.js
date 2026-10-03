const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTrueSkillFromMatches } = require('../src/lib/trueskill-matches');
const { buildChampionProfile } = require('../src/lib/champion-profile');
const { championKey } = require('../src/lib/champion-releases');

// Two teams (captain + one pick each) over two games. Alpha wins both, so
// Ann's Syndra wins and Cy's Syndra loses. Syndra is picked by Ann (game 1) and Cy (game 2); Lee Sin
// is only ever banned.
const draftRows = [
  { year: 2026, tournament: 'Summer', captain: 'Alpha', groupVal: 'Ann', identityKey: 'Ann', displayName: 'Ann' },
  { year: 2026, tournament: 'Summer', captain: 'Beta', groupVal: 'Cy', identityKey: 'Cy', displayName: 'Cy' },
];

const detail = (matchKey, player, champion, kills, deaths, assists, role) => ({
  matchKey,
  player,
  champion,
  championKey: championKey(champion),
  kills,
  deaths,
  assists,
  role,
});

function matches() {
  return [
    {
      year: 2026, tournament: 'Summer', team1: 'Alpha', team2: 'Beta', result: 'Alpha',
      matchOrder: 1, rowIndex: 0, matchKey: 'g1', matchStage: 'Groups',
      details: [
        detail('g1', 'Alpha', 'Garen', 1, 1, 1, 'Top'),
        detail('g1', 'Ann', 'Syndra', 8, 2, 6, 'Mid'),
        detail('g1', 'Beta', 'Ashe', 3, 3, 3, 'Bot'),
        detail('g1', 'Cy', 'Leona', 0, 4, 9, 'Supp'),
      ],
      bans: { team1: [], team2: [{ champion: 'Lee Sin', key: 'leesin' }] },
    },
    {
      year: 2026, tournament: 'Summer', team1: 'Alpha', team2: 'Beta', result: 'Alpha',
      matchOrder: 2, rowIndex: 1, matchKey: 'g2', matchStage: 'Groups',
      details: [
        detail('g2', 'Alpha', 'Sivir', 2, 2, 2, 'Bot'),
        detail('g2', 'Ann', 'Ahri', 4, 4, 4, 'Mid'),
        detail('g2', 'Beta', 'Nautilus', 1, 1, 1, 'Supp'),
        detail('g2', 'Cy', 'Syndra', 5, 0, 7, 'Mid'),
      ],
      bans: { team1: [{ champion: 'Lee Sin', key: 'leesin' }], team2: [] },
    },
  ];
}

async function run(key) {
  const result = await computeTrueSkillFromMatches(matches(), draftRows, new Map(), {});
  return buildChampionProfile({ key, games: result.games, players: result.players, resolve: (name) => name });
}

test('buildChampionProfile lists each pick in play order, from the picker\'s side', async () => {
  const profile = await run('syndra');

  assert.equal(profile.champion, 'Syndra');
  assert.equal(profile.games, 2);
  assert.equal(profile.wins, 1);
  assert.equal(profile.losses, 1);
  assert.deepEqual(profile.history.map((e) => e.matchKey), ['g1', 'g2']);

  const [first, second] = profile.history;
  assert.deepEqual(first.player, { identityKey: 'Ann', displayName: 'Ann' });
  assert.equal(first.outcome, 'win');
  assert.equal(first.ownTeam.name, 'Alpha');
  assert.equal(first.opponent, 'Beta');
  assert.equal(first.playerDetails[0].champion, 'Syndra');

  assert.deepEqual(second.player, { identityKey: 'Cy', displayName: 'Cy' });
  assert.equal(second.outcome, 'loss');
  assert.equal(second.ownTeam.name, 'Beta');
});

test('buildChampionProfile reports the other champions on each side', async () => {
  const { history } = await run('syndra');

  // Game 1: Ann (Alpha) played Syndra alongside Garen, against Ashe and Leona.
  assert.deepEqual(history[0].teamChampions.map((c) => c.key), ['garen']);
  assert.deepEqual(history[0].opponentChampions.map((c) => c.key).sort(), ['ashe', 'leona']);
  assert.equal(history[0].teamChampions[0].role, 'Top');
  // Game 2: Cy (Beta) alongside Nautilus, against Sivir and Ahri.
  assert.deepEqual(history[1].teamChampions.map((c) => c.key), ['nautilus']);
  assert.deepEqual(history[1].opponentChampions.map((c) => c.key).sort(), ['ahri', 'sivir']);
});

test('buildChampionProfile finds the opposing player in the same role', async () => {
  const { history } = await run('syndra');

  // Game 1: Ann's Mid has no opposing Mid (Beta played Bot and Supp).
  assert.equal(history[0].laneOpponent, null);
  // Game 2: Cy (Mid, Beta) faces Alpha's Ahri... which Ann played Mid for Alpha.
  assert.deepEqual(history[1].laneOpponent, {
    champion: 'Ahri', key: 'ahri', role: 'Mid', kills: 4, deaths: 4, assists: 4,
  });
});

test('buildChampionProfile counts bans, and a banned-only champion still has a name', async () => {
  const banned = await run('leesin');
  assert.equal(banned.champion, 'Lee Sin');
  assert.equal(banned.games, 0);
  assert.equal(banned.gamesBanned, 2);
  assert.deepEqual(banned.history, []);

  const syndra = await run('syndra');
  assert.equal(syndra.gamesBanned, 0);
});

test('buildChampionProfile has no champion name when it was never picked or banned', async () => {
  const profile = await run('zed');
  assert.equal(profile.champion, null);
  assert.equal(profile.games, 0);
});
