import { describe, expect, it } from "vitest";
import rawMatches from "../../test-fixtures/rawmatches.json";
import {
  applyReplayToForm,
  captainOptions,
  championDisplayName,
  matchOptions,
  nameMatchStrength,
  opponentOptions,
  planReplayImport,
  slotKey,
  suggestMatches,
} from "../utils/replayMatching";
import { readReplayFile } from "../utils/roflReplay";
import { fixtureReplayFile } from "./replayTestUtils";

const slot = (name, extra = {}) => ({ player: name, displayName: name, champion: "", kills: "", deaths: "", assists: "", role: "", ...extra });
// The editor state for 2024 Summer Groups 3 (Voidliss won), as the server builds it.
function matchState(overrides = {}) {
  return {
    winnerSide: 1,
    championSuggestions: ["Miss Fortune", "Wukong"],
    teams: [
      { side: 1, name: "Voidliss#NA1", players: ["Voidliss#NA1", "Ene#TFT", "RichGamebuddy#NA1", "Bloodyninja1122#NA1", "LightningFst#1008"].map((n) => slot(n)) },
      { side: 2, name: "Yeetor#0828", players: ["Yeetor#0828", "Korobasne#NA1", "ricethesameater#NA1", "Brishin#bris", "NotElectro#3754"].map((n) => slot(n)) },
    ],
    ...overrides,
  };
}
const formFor = (state) => ({ teams: state.teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p })) })) });
const load = (name) => readReplayFile(fixtureReplayFile(name, `${name}.rofl`));
const nameOf = (plan, replay, key) => replay.players.find((p) => plan.assign[p.index] === key)?.gameName;

describe("name matching", () => {
  const player = (gameName, tagLine = "") => ({ gameName, tagLine });
  it("scores full Riot IDs above bare game names, ignoring case and accents", () => {
    expect(nameMatchStrength(player("Ène", ""), "Ene#TFT")).toBe(2);
    expect(nameMatchStrength(player("brishin", "BRIS"), "Brishin#bris")).toBe(3);
    expect(nameMatchStrength(player("Brishin", "other"), "Brishin#bris")).toBe(1);
    expect(nameMatchStrength(player("Nobody"), "Brishin#bris")).toBe(0);
    expect(nameMatchStrength(player(""), "Brishin#bris")).toBe(0);
  });
});

describe("planReplayImport on the real 14.16 replay", () => {
  it("pairs the eight known players, leaves the two renamed ones for a human", async () => {
    const replay = await load("voidlissYeetor");
    const plan = planReplayImport(replay, matchState());
    expect(plan.swap).toBe(false);
    expect(plan.sideBasis).toBe("names");
    expect(nameOf(plan, replay, slotKey(0, 1))).toBe("Ène");
    expect(nameOf(plan, replay, slotKey(1, 1))).toBe("Korobasne");
    expect(nameOf(plan, replay, slotKey(1, 3))).toBe("Brishin");
    const unassigned = replay.players.filter((p) => !plan.assign[p.index]).map((p) => p.gameName).sort();
    expect(unassigned).toEqual(["Lúnar", "geyouqianqiu"]);
    expect(plan.guessed).toEqual([]); // two leftovers each way is ambiguous: no guessing
    expect(plan.warnings.map((w) => w.level)).toEqual(["notice"]);
  });

  it("works out the sides when the teams are the other way round", async () => {
    const replay = await load("voidlissYeetor");
    const state = matchState();
    const flipped = matchState({ winnerSide: 2, teams: [state.teams[1], state.teams[0]] });
    const plan = planReplayImport(replay, flipped);
    expect(plan.swap).toBe(true);
    expect(plan.sideBasis).toBe("names");
    expect(plan.warnings.some((w) => w.level === "alert")).toBe(false);
  });

  it("falls back to the recorded winner when no names help, and flags a winner mismatch", async () => {
    const replay = await load("voidlissYeetor");
    const strangers = (n) => Array.from({ length: 5 }, (_, i) => slot(`Stranger ${n}${i}`));
    const state = matchState({
      teams: [{ side: 1, name: "A", players: strangers("a") }, { side: 2, name: "B", players: strangers("b") }],
      winnerSide: 2,
    });
    const plan = planReplayImport(replay, state);
    expect(plan.sideBasis).toBe("winner");
    expect(plan.swap).toBe(true); // replay's winners (team 100) become Team 2
    const alerts = plan.warnings.filter((w) => w.level === "alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].text).toMatch(/None of the replay's player names match/);

    // Names say one thing, the recorded result says the other: warn loudly.
    const wrongWinner = planReplayImport(replay, matchState({ winnerSide: 2 }));
    expect(wrongWinner.warnings.find((w) => w.level === "alert").text).toMatch(/recorded as a win for Yeetor#0828/);
  });

  it("pairs a lone leftover player and slot, but marks it as a guess", async () => {
    const replay = await load("voidlissYeetor");
    const state = matchState();
    state.teams[1].players[2] = slot("Lúnar#NA1"); // only geyouqianqiu is left over for NotElectro
    const plan = planReplayImport(replay, state);
    const guessedPlayer = replay.players.find((p) => plan.guessed.includes(p.index));
    expect(guessedPlayer.gameName).toBe("geyouqianqiu");
    expect(plan.assign[guessedPlayer.index]).toBe(slotKey(1, 4));
  });

  it("honors a forced swap", async () => {
    const replay = await load("voidlissYeetor");
    const plan = planReplayImport(replay, matchState(), { swap: true });
    expect(plan.sideBasis).toBe("manual");
    expect(Object.values(plan.assign).filter(Boolean)).toHaveLength(0); // names no longer line up
    expect(plan.warnings.some((w) => w.level === "alert")).toBe(true);
  });
});

describe("planReplayImport edge cases", () => {
  it("assigns nothing for a replay without player names, and says why", async () => {
    const replay = await load("noRoles");
    const plan = planReplayImport({ ...replay, hasNames: false, players: replay.players.map((p) => ({ ...p, gameName: "", tagLine: "", riotId: "" })) }, matchState());
    expect(Object.values(plan.assign).every((v) => v === null)).toBe(true);
    expect(plan.warnings.map((w) => w.text).join(" ")).toMatch(/doesn't include player names/);
    expect(plan.warnings.map((w) => w.text).join(" ")).toMatch(/no role data/);
  });

  it("matches an exact Name#Tag in newer replays", async () => {
    const replay = await load("premadeVsRandoms");
    const state = matchState({
      winnerSide: 1,
      teams: [
        { side: 1, name: "Xemacs#LOR", players: ["Xemacs#LOR", "MENTAL MOUNTAIN#KEN", "Feiro#NA1", "benbooee#BEN", "Inspiring#309"].map((n) => slot(n)) },
        { side: 2, name: "Other#1", players: ["a#1", "b#2", "c#3", "d#4", "e#5"].map((n) => slot(n)) },
      ],
    });
    const plan = planReplayImport(replay, state);
    expect(plan.swap).toBe(false);
    expect(Object.values(plan.assign).filter(Boolean)).toHaveLength(5);
    expect(nameOf(plan, replay, slotKey(0, 1))).toBe("MENTAL MOUNTAIN");
  });
});

describe("applyReplayToForm", () => {
  it("fills champion, K/D/A and role only for assigned slots", async () => {
    const replay = await load("voidlissYeetor");
    const state = matchState();
    const plan = planReplayImport(replay, state);
    const form = applyReplayToForm(formFor(state), replay, plan.assign, state.championSuggestions);
    expect(form.teams[0].players[1]).toMatchObject({ champion: "Ahri", kills: "13", deaths: "1", assists: "11", role: "Mid" });
    expect(form.teams[1].players[0]).toMatchObject({ champion: "Miss Fortune", role: "Bot" }); // known spelling used
    expect(form.teams[1].players[2]).toMatchObject({ champion: "", role: "" }); // unassigned slot untouched
  });

  it("keeps an existing role when the replay has none", async () => {
    const replay = await load("noRoles");
    const state = matchState();
    state.teams[0].players[0].role = "Top";
    const assign = { [replay.players[0].index]: slotKey(0, 0) };
    const form = applyReplayToForm(formFor(state), replay, assign, []);
    expect(form.teams[0].players[0].role).toBe("Top");
    expect(form.teams[0].players[0].champion).toBe(replay.players[0].champion);
  });

  it("turns internal champion ids into readable names", () => {
    expect(championDisplayName("MonkeyKing", [])).toBe("Wukong");
    expect(championDisplayName("MissFortune", [])).toBe("Miss Fortune");
    expect(championDisplayName("JarvanIV", [])).toBe("Jarvan IV");
    expect(championDisplayName("Leblanc", ["LeBlanc"])).toBe("LeBlanc");
    expect(championDisplayName("MonkeyKing", ["Wukong"])).toBe("Wukong");
  });
});

describe("choosing the match", () => {
  const rows = rawMatches.rows;
  it("offers only captains the first captain has faced, and only their meetings", () => {
    const all = captainOptions(rows);
    expect(opponentOptions(rows, "")).toEqual(all);
    const opponents = opponentOptions(rows, "Yeetor#0828");
    expect(opponents.length).toBeGreaterThan(0);
    expect(opponents.length).toBeLessThan(all.length);
    expect(opponents).toContain("Voidliss#NA1");
    for (const opponent of opponents) {
      expect(matchOptions(rows, "Yeetor#0828", opponent).length).toBeGreaterThan(0);
    }
    const never = all.find((c) => c !== "Yeetor#0828" && !opponents.includes(c));
    expect(matchOptions(rows, "Yeetor#0828", never)).toEqual([]);

    const meetings = matchOptions(rows, "Voidliss#NA1", "Yeetor#0828");
    expect(meetings.map((m) => m.match_key)).toContain("match-2024-summer-groups-3-voidliss-na1-yeetor-0828");
    expect(meetings.every((m) => [m.team1, m.team2].sort().join() === ["Voidliss#NA1", "Yeetor#0828"].sort().join())).toBe(true);
    // Order of the two captains doesn't matter.
    expect(matchOptions(rows, "Yeetor#0828", "Voidliss#NA1")).toEqual(meetings);
    // One captain: all of their matches, newest first.
    const one = matchOptions(rows, "Voidliss#NA1", "");
    expect(one.length).toBeGreaterThan(meetings.length);
    expect(Number(one[0].year)).toBeGreaterThanOrEqual(Number(one[one.length - 1].year));
  });

  it("suggests the right match for the real replay and nothing for the unrelated ones", async () => {
    const [best] = suggestMatches(await load("voidlissYeetor"), rows);
    expect(best.row.match_key).toBe("match-2024-summer-groups-3-voidliss-na1-yeetor-0828");
    expect(best.score).toBeGreaterThanOrEqual(8);
    expect(suggestMatches(await load("premadeVsRandoms"), rows)).toEqual([]);
    expect(suggestMatches(await load("noRoles"), rows)).toEqual([]);
  });
});
