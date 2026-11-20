import { describe, expect, it } from "vitest";
import { sortMatchesByTournamentStructure } from "../utils/matchOrdering";

describe("sortMatchesByTournamentStructure", () => {
  it("uses stage order and keeps games in an assigned round together", () => {
    const matches = [
      { matchKey: "later-stage", year: 2026, tournament: "Summer", matchOrder: 1, stageId: "playoffs", stageOrder: 2 },
      { matchKey: "round-2-a", year: 2026, tournament: "Summer", matchOrder: 2, stageId: "groups", stageOrder: 1, round: "Round 2" },
      { matchKey: "round-1", year: 2026, tournament: "Summer", matchOrder: 3, stageId: "groups", stageOrder: 1, round: "Round 1" },
      { matchKey: "round-2-b", year: 2026, tournament: "Summer", matchOrder: 4, stageId: "groups", stageOrder: 1, round: "Round 2" },
    ];

    expect(sortMatchesByTournamentStructure(matches).map((match) => match.matchKey)).toEqual([
      "round-1",
      "round-2-a",
      "round-2-b",
      "later-stage",
    ]);
  });

  it("recognizes semifinal and final labels before using match order", () => {
    const matches = [
      { matchKey: "final", year: 2026, tournament: "Summer", matchOrder: 1, stageId: "playoffs", stageOrder: 1, round: "Finals" },
      { matchKey: "semis", year: 2026, tournament: "Summer", matchOrder: 2, stageId: "playoffs", stageOrder: 1, round: "Semifinals" },
    ];

    expect(sortMatchesByTournamentStructure(matches).map((match) => match.matchKey)).toEqual(["semis", "final"]);
  });

  it("orders round-of elimination labels from larger brackets to smaller ones", () => {
    const matches = [
      { matchKey: "round-16", year: 2026, tournament: "Summer", matchOrder: 1, stageId: "playoffs", stageOrder: 1, round: "Round of 16" },
      { matchKey: "round-32", year: 2026, tournament: "Summer", matchOrder: 2, stageId: "playoffs", stageOrder: 1, round: "Round of 32" },
    ];

    expect(sortMatchesByTournamentStructure(matches).map((match) => match.matchKey)).toEqual(["round-32", "round-16"]);
  });

  it("falls back to recorded order when tournament structure is absent", () => {
    const matches = [
      { matchKey: "second", year: 2026, tournament: "Summer", matchOrder: 2 },
      { matchKey: "first", year: 2026, tournament: "Summer", matchOrder: 1 },
    ];

    expect(sortMatchesByTournamentStructure(matches).map((match) => match.matchKey)).toEqual(["first", "second"]);
  });

  it("preserves input chronology when an older history has no match order", () => {
    const matches = [
      { matchKey: "first", gameIndex: 5 },
      { matchKey: "second", gameIndex: 1 },
    ];

    expect(sortMatchesByTournamentStructure(matches).map((match) => match.matchKey)).toEqual(["first", "second"]);
  });
});
