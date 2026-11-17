import { describe, expect, it } from "vitest";
import {
  computeChampionMatchupRows,
  computeChampionMatchups,
  computeRoleAgainstRecords,
  pickExtreme,
} from "../utils/profileCompute";

describe("computeRoleAgainstRecords", () => {
  it("counts only games where both players played the selected role", () => {
    const history = [
      {
        outcome: "win",
        playerDetails: [{ role: "Mid" }],
        details: [
          { identityKey: "opponent", role: "Bot" },
          { identityKey: "other", role: "Mid" },
        ],
        opponentTeam: {
          roster: [
            { identityKey: "opponent", displayName: "Opponent#NA1" },
            { identityKey: "other", displayName: "Other#NA1" },
          ],
        },
      },
      {
        outcome: "loss",
        playerDetails: [{ role: "Mid" }],
        details: [{ identityKey: "opponent", role: "Mid" }],
        opponentTeam: {
          roster: [{ identityKey: "opponent", displayName: "Opponent#NA1" }],
        },
      },
      {
        outcome: "win",
        playerDetails: [{ role: "Bot" }],
        details: [{ identityKey: "opponent", role: "Mid" }],
        opponentTeam: {
          roster: [{ identityKey: "opponent", displayName: "Opponent#NA1" }],
        },
      },
    ];

    const against = computeRoleAgainstRecords(history, "Mid");

    expect(against.get("opponent")).toMatchObject({ games: 1, wins: 0 });
    expect(against.get("other")).toMatchObject({ games: 1, wins: 1 });
  });
});

describe("computeChampionMatchups", () => {
  it("keeps Jhin Bot versus Syndra Bot separate from Bot versus Syndra Mid", () => {
    const history = [
      {
        outcome: "win",
        playerDetails: [{ role: "Bot" }],
        opponentChampions: [{ key: "syndra", champion: "Syndra", role: "Bot" }],
        laneOpponent: { key: "syndra", champion: "Syndra", role: "Bot" },
      },
      {
        outcome: "loss",
        playerDetails: [{ role: "Bot" }],
        opponentChampions: [{ key: "syndra", champion: "Syndra", role: "Mid" }],
        laneOpponent: null,
      },
      {
        outcome: "loss",
        playerDetails: [{ role: "Mid" }],
        opponentChampions: [{ key: "syndra", champion: "Syndra", role: "Mid" }],
        laneOpponent: { key: "syndra", champion: "Syndra", role: "Mid" },
      },
    ];

    const { againstMap, againstSameRoleByRole } = computeChampionMatchups(history);

    expect(againstMap.get("syndra")).toMatchObject({ games: 3, wins: 1 });
    expect(againstSameRoleByRole.get("Bot").get("syndra")).toMatchObject({ games: 1, wins: 1 });
    expect(againstSameRoleByRole.get("Mid").get("syndra")).toMatchObject({ games: 1, wins: 0 });
    expect(pickExtreme(againstSameRoleByRole.get("Bot"), "max")).toMatchObject({ key: "syndra", winRate: 1 });
  });

  it("creates separate matchup table rows when an enemy champion appears in multiple roles", () => {
    const history = [
      {
        outcome: "win",
        playerDetails: [{ role: "Bot", kills: 8, deaths: 1, assists: 4 }],
        laneOpponent: { key: "syndra", champion: "Syndra", role: "Bot" },
      },
      {
        outcome: "loss",
        playerDetails: [{ role: "Bot", kills: 2, deaths: 5, assists: 3 }],
        laneOpponent: null,
      },
      {
        outcome: "loss",
        playerDetails: [{ role: "Mid", kills: 1, deaths: 4, assists: 1 }],
        laneOpponent: { key: "syndra", champion: "Syndra", role: "Mid" },
      },
    ];

    expect(computeChampionMatchupRows(history)).toEqual([
      expect.objectContaining({ role: "Mid", champion: "Syndra", games: 1, wins: 0, winRate: 0, kda: 0.5 }),
      expect.objectContaining({ role: "Bot", champion: "Syndra", games: 1, wins: 1, winRate: 1, kda: 12 }),
    ]);
  });
});