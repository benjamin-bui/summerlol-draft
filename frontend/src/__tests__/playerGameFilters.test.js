import { describe, expect, it } from "vitest";
import {
  filterPlayerHistory,
  getPlayerGameFilterOptions,
  summarizePlayerGames,
  tournamentFilterKey,
  UNRECORDED_ROLE,
} from "../utils/playerGameFilters";

const game = (year, tournament, role, outcome, champion) => ({
  year,
  tournament,
  outcome,
  playerDetails: role || champion ? [{ role, champion }] : [],
});

describe("player game filters", () => {
  const history = [
    game(2025, "Summer", "Top", "win", "Ahri"),
    game(2025, "Summer", "Mid", "loss", "Ahri"),
    game(2025, "Winter", "Top", "loss", "Lux"),
    game(2025, "Summer", null, "draw", null),
  ];

  it("uses only games matching both the tournament and role for row statistics", () => {
    const tournament = tournamentFilterKey({ year: 2025, tournament: "Summer" });
    const matching = filterPlayerHistory(history, tournament, "Top");

    expect(summarizePlayerGames(matching)).toMatchObject({
      games: 1,
      tournaments: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      latestGameTournament: "Summer 2025",
      championDiversity: null,
    });
  });

  it("offers and filters games with no recorded role separately", () => {
    const options = getPlayerGameFilterOptions([{ history }]);
    expect(options.roles).toEqual(["Top", "Mid"]);
    expect(options.hasUnrecordedRole).toBe(true);
    expect(filterPlayerHistory(history, "", UNRECORDED_ROLE)).toEqual([history[3]]);
  });

  it("counts unique tournaments and computes diversity from selected champion games", () => {
    const matching = filterPlayerHistory(history, "", "Top");
    const stats = summarizePlayerGames(matching, 2);
    expect(stats).toMatchObject({
      games: 2,
      tournaments: 2,
      wins: 1,
      losses: 1,
      championDiversity: 0.5,
      championDiversityGames: 2,
    });
  });
});
