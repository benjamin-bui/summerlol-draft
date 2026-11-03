import { describe, expect, it } from "vitest";
import { checkTotals } from "../utils/screenshotImport";
import { LayoutError, layoutFromHeaders } from "../utils/screenshotLayout";

const players = [
  { team: 0, kills: 4, deaths: 7, assists: 18 },
  { team: 0, kills: 7, deaths: 4, assists: 16 },
  { team: 1, kills: 5, deaths: 7, assists: 11 },
  { team: 1, kills: 6, deaths: 4, assists: 10 },
];

describe("client screenshot checks", () => {
  it("verifies totals that agree with the extracted K/D/A", () => {
    const result = checkTotals(players, [["11/11/34"], ["11/11/21"]]);
    expect(result.verdicts).toEqual([true, true]);
    expect(result.checks).toEqual([]);
  });

  it("does not mark totals verified when kills and deaths contradict", () => {
    const result = checkTotals(players, [[], []]);
    expect(result.verdicts).toEqual([null, null]);
    expect(result.checks).toEqual([]);
  });

  it("rejects headings that cannot form a scoreboard layout", () => {
    expect(() => layoutFromHeaders({ x: 100, y: 200, h: 10 }, { x: 100, y: 100, h: 10 }, { width: 1200, height: 900 })).toThrow(
      LayoutError,
    );
  });
});
