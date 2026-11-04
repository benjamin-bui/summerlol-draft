import { describe, expect, it } from "vitest";
import { buildRoleIndex, getRoleIndex, suggestTeamRoles } from "../utils/roleAssignment";

const NONE = buildRoleIndex([]);
const member = (id, champion, extra = {}) => ({ id, names: [`P${id}#NA1`], champion, ...extra });
const game = (key, year, players) => ({ match_key: key, year, match_details: players });

describe("guessing a team's roles", () => {
  it("gives a team five different roles from its champions alone", () => {
    const roles = suggestTeamRoles(NONE, [member(0, "Garen"), member(1, "Lee Sin"), member(2, "Ahri"), member(3, "Jinx"), member(4, "Thresh")]);
    expect(roles).toEqual({ 0: "Top", 1: "Jungle", 2: "Mid", 3: "Bot", 4: "Supp" });
  });

  it("resolves two champions that both want the same role by who has to go elsewhere", () => {
    // Ashe and Jinx are both marksmen; Ashe's second-best role is Support, Jinx has none.
    const roles = suggestTeamRoles(NONE, [member(0, "Garen"), member(1, "Lee Sin"), member(2, "Ahri"), member(3, "Jinx"), member(4, "Ashe")]);
    expect(roles[3]).toBe("Bot");
    expect(roles[4]).toBe("Supp");
  });

  it("follows a player's own history over what their champion usually does", () => {
    const history = [1, 2, 3].map((n) => game(`g${n}`, 2026, [{ player: "P0#NA1", role: "Supp", champion: "Ahri" }]));
    const roles = suggestTeamRoles(buildRoleIndex(history), [member(0, "Ahri"), member(1, "Garen"), member(2, "Lee Sin"), member(3, "Jinx"), member(4, "Syndra")]);
    expect(roles[0]).toBe("Supp");
    expect(roles[4]).toBe("Mid");
  });

  it("leaves a role blank rather than guess when nothing separates the options", () => {
    const roles = suggestTeamRoles(NONE, [member(0, "Locke")]);
    expect(roles).toEqual({});
  });

  it("does not hand out roles that other players of the team already hold", () => {
    const roles = suggestTeamRoles(NONE, [member(0, "Ahri")], { taken: ["Mid"] });
    expect(roles[0]).not.toBe("Mid");
  });

  it("matches a person by any name they go by, preferring a full Riot ID to a bare name", () => {
    const history = [
      game("a", 2026, [{ player: "Old#NA1", role: "Jungle", champion: "Zed" }, { player: "Old#EUW", role: "Top", champion: "Zed" }]),
      game("b", 2026, [{ player: "Old#NA1", role: "Jungle", champion: "Zed" }]),
    ];
    const index = buildRoleIndex(history);
    const only = (names) => suggestTeamRoles(index, [{ id: 0, names, champion: "Locke" }]);
    expect(only(["Old#NA1"])[0]).toBe("Jungle"); // exact Riot ID: just that account's games
    expect(only(["Old#EUW"])[0]).toBe("Top");
    expect(only(["Brand New#1", "Old#NA1"])[0]).toBe("Jungle"); // any of their names will do
    expect(only(["Nobody#1"])).toEqual({});
  });

  it("falls back to the bare game name when no full Riot ID has history", () => {
    const history = [game("a", 2026, [{ player: "Old#NA1", role: "Mid" }]), game("b", 2026, [{ player: "Old#NA1", role: "Mid" }])];
    const roles = suggestTeamRoles(buildRoleIndex(history), [{ id: 0, names: ["Old"], champion: "Locke" }]);
    expect(roles[0]).toBe("Mid");
  });

  it("ignores a match's own stored roles when it is the one being edited", () => {
    const rows = [game("this", 2026, [{ player: "P0#NA1", role: "Top" }, { player: "P0#NA1", role: "Top" }, { player: "P0#NA1", role: "Top" }])];
    expect(suggestTeamRoles(getRoleIndex(rows, null), [member(0, "Locke")])[0]).toBe("Top");
    expect(suggestTeamRoles(getRoleIndex(rows, "this"), [member(0, "Locke")])).toEqual({});
  });

  it("weighs recent seasons a little more than old ones, without letting one game outvote many", () => {
    const player = [{ id: 0, names: ["P0#NA1"], champion: "Locke" }];
    const top = (year, n) => game(`t${year}${n}`, year, [{ player: "P0#NA1", role: "Top" }]);
    const bot = (year) => game(`b${year}`, year, [{ player: "P0#NA1", role: "Bot" }]);
    // A tie on games is settled by recency...
    expect(suggestTeamRoles(buildRoleIndex([top(2022, 1), bot(2026)]), player)[0]).toBe("Bot");
    // ...but three older games still beat one recent one.
    expect(suggestTeamRoles(buildRoleIndex([top(2022, 1), top(2022, 2), top(2022, 3), bot(2026)]), player)[0]).toBe("Top");
    // And two older games against one recent one is too close to call.
    expect(suggestTeamRoles(buildRoleIndex([top(2022, 1), top(2022, 2), bot(2026)]), player)).toEqual({});
  });

  it("copes with a team of fewer than five and with nobody at all", () => {
    expect(suggestTeamRoles(NONE, [])).toEqual({});
    expect(suggestTeamRoles(NONE, [member(0, "Garen"), member(1, "Thresh")])).toEqual({ 0: "Top", 1: "Supp" });
  });
});

describe("scoreboard row order", () => {
  // Garen, Ahri and Jinx are certain; the two Lockes (no built-in roles) could be Jungle and
  // Support either way round -- only the order of the rows can say which.
  const team = (order) => order.map((champion, position) => member(champion, champion, { position }));

  it("breaks the tie when the players we are sure of already sit in role order", () => {
    const roles = suggestTeamRoles(NONE, [
      { id: "garen", names: ["a#1"], champion: "Garen", position: 0 },
      { id: "locke1", names: ["b#1"], champion: "Locke", position: 1 },
      { id: "ahri", names: ["c#1"], champion: "Ahri", position: 2 },
      { id: "jinx", names: ["d#1"], champion: "Jinx", position: 3 },
      { id: "locke2", names: ["e#1"], champion: "Locke", position: 4 },
    ]);
    expect(roles).toMatchObject({ garen: "Top", ahri: "Mid", jinx: "Bot", locke1: "Jungle", locke2: "Supp" });
  });

  it("ignores the order when the players we are sure of are not in it", () => {
    const roles = suggestTeamRoles(NONE, [
      { id: "jinx", names: ["a#1"], champion: "Jinx", position: 0 },
      { id: "locke1", names: ["b#1"], champion: "Locke", position: 1 },
      { id: "garen", names: ["c#1"], champion: "Garen", position: 2 },
      { id: "ahri", names: ["d#1"], champion: "Ahri", position: 3 },
      { id: "locke2", names: ["e#1"], champion: "Locke", position: 4 },
    ]);
    expect(roles).toMatchObject({ jinx: "Bot", garen: "Top", ahri: "Mid" });
    expect(roles.locke1).toBeUndefined();
    expect(roles.locke2).toBeUndefined();
  });

  it("does nothing special for a team whose rows have no known order", () => {
    expect(suggestTeamRoles(NONE, team(["Garen", "Ahri", "Jinx", "Thresh", "Lee Sin"]))).toMatchObject({ Garen: "Top", Ahri: "Mid", Jinx: "Bot", Thresh: "Supp", "Lee Sin": "Jungle" });
  });
});
