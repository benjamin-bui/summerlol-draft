import { describe, expect, it } from "vitest";
import {
  MAX_GROUPS,
  assignTeam,
  defaultGroupName,
  groupIndexOfTeam,
  groupsPayload,
  resizeGroups,
  roundsFromMatchOrder,
  suggestGroups,
  tournamentTeams,
} from "../utils/roundRobinGroups";

const games = [
  { team1: "Alpha", team2: "Beta" },
  { team1: "Gamma", team2: "Delta" },
  { team1: "beta", team2: "Epsilon" },
  { team1: "Delta", team2: "Zeta" },
  { team1: "Gamma", team2: "Zeta" },
];

describe("round-robin group helpers", () => {
  it("lists distinct teams alphabetically, ignoring case differences", () => {
    expect(tournamentTeams(games)).toEqual(["Alpha", "Beta", "Delta", "Epsilon", "Gamma", "Zeta"]);
    expect(tournamentTeams(undefined)).toEqual([]);
  });

  it("resizes the group list, keeping existing groups and naming new ones", () => {
    const grown = resizeGroups([{ name: "Group A", teams: ["x"] }], 3);
    expect(grown.map((group) => group.name)).toEqual(["Group A", "Group B", "Group C"]);
    expect(grown[0].teams).toEqual(["x"]);
    // A renamed group frees its default name for reuse.
    expect(resizeGroups([{ name: "Blue", teams: [] }], 2).map((group) => group.name)).toEqual(["Blue", "Group A"]);
    expect(resizeGroups(grown, 1)).toEqual([{ name: "Group A", teams: ["x"] }]);
    expect(resizeGroups(grown, "")).toEqual([]);
    expect(resizeGroups([], 99)).toHaveLength(MAX_GROUPS);
    expect(defaultGroupName(0)).toBe("Group A");
  });

  it("keeps a team in at most one group when reassigning", () => {
    let groups = [{ name: "A", teams: [] }, { name: "B", teams: [] }];
    groups = assignTeam(groups, "Alpha", 0);
    groups = assignTeam(groups, "Alpha", 1);
    expect(groups.map((group) => group.teams)).toEqual([[], ["Alpha"]]);
    expect(groupIndexOfTeam(groups, "alpha")).toBe(1);
    groups = assignTeam(groups, "Alpha", -1);
    expect(groupIndexOfTeam(groups, "Alpha")).toBe(-1);
  });

  it("suggests groups as connected components of who played whom, largest first", () => {
    // Two groups of three: ties keep the order teams first appear in.
    expect(suggestGroups(games)).toEqual([
      { name: "Group A", teams: ["Alpha", "Beta", "Epsilon"] },
      { name: "Group B", teams: ["Gamma", "Delta", "Zeta"] },
    ]);
    // A bigger component moves to the front.
    expect(suggestGroups([...games, { team1: "Zeta", team2: "Eta" }])).toEqual([
      { name: "Group A", teams: ["Gamma", "Delta", "Zeta", "Eta"] },
      { name: "Group B", teams: ["Alpha", "Beta", "Epsilon"] },
    ]);
    expect(suggestGroups([])).toEqual([]);
  });

  it("sends groups only for round-robin stages and omits IDs for new groups", () => {
    const stage = {
      format: "round-robin",
      groups: [{ groupId: "g1", name: "A", teams: ["x"] }, { name: "B", teams: [] }],
    };
    expect(groupsPayload(stage)).toEqual([{ groupId: "g1", name: "A", teams: ["x"] }, { name: "B", teams: [] }]);
    expect(groupsPayload({ ...stage, format: "swiss" })).toEqual([]);
    expect(groupsPayload({ format: "round-robin" })).toEqual([]);
  });

  it("numbers rounds from match order, sharing a round between concurrent games and placing a series by its first game", () => {
    const picked = [
      { matchKey: "a", matchOrder: 10 },
      { matchKey: "b", matchOrder: 10 },
      { matchKey: "c", matchOrder: 20, seriesId: "s1" },
      { matchKey: "d", matchOrder: 12, seriesId: "s1" },
      { matchKey: "e", matchOrder: 30 },
    ];
    expect(roundsFromMatchOrder(picked)).toEqual([
      { matchKey: "a", round: "Round 1" },
      { matchKey: "b", round: "Round 1" },
      { matchKey: "d", round: "Round 2" },
      { matchKey: "e", round: "Round 3" },
    ]);
    expect(roundsFromMatchOrder([])).toEqual([]);
  });
});
