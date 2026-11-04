import { describe, expect, it } from "vitest";
import rawMatches from "../../test-fixtures/rawmatches.json";
import {
  applyReplayToForm,
  captainOptions,
  championDisplayName,
  matchOptions,
  nameMatchStrength,
  opponentOptions,
  pastNameCandidates,
  planReplayImport,
  reapplyReplay,
  resolveRoles,
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

  it("recognises a name the roster player used to go by, just below a match on their current name", () => {
    expect(nameMatchStrength(player("Lúnar"), "Voidliss#NA1")).toBe(0);
    expect(nameMatchStrength(player("Lunar"), "Voidliss#NA1", ["Lúnar"])).toBe(1.8);
    expect(nameMatchStrength(player("Lunar", "OLD"), "Voidliss#NA1", ["Lunar#OLD"])).toBe(1.9);
    expect(nameMatchStrength(player("Voidliss"), "Voidliss#NA1", ["Lunar"])).toBe(2); // the current name still wins
    expect(nameMatchStrength({ ...player("Lunnar"), ocr: true }, "Voidliss#NA1", ["Lunar"])).toBe(1.4); // read from pixels
  });

  it("uses past names to pair a renamed player with the right slot", async () => {
    const replay = await load("voidlissYeetor");
    const plain = planReplayImport(replay, matchState());
    const renamed = replay.players.find((p) => p.gameName === "Lúnar");
    expect(plain.assign[renamed.index]).toBe(null); // nothing on the roster says who this is
    // The slots nobody was paired with, on this player's side.
    const side = plain.sideOf(renamed.team);
    const taken = new Set(Object.values(plain.assign));
    const freeKeys = matchState().teams[side].players.map((_, i) => slotKey(side, i)).filter((key) => !taken.has(key));
    expect(freeKeys.length).toBeGreaterThan(1); // two leftovers: too ambiguous to guess
    // Once the roster says one of them used to be "Lunar", the pairing is certain.
    const state = matchState();
    const [freeSide, freeIndex] = freeKeys[0].split(":").map(Number);
    state.teams[freeSide].players[freeIndex].pastNames = ["Lunar"];
    const plan = planReplayImport(replay, state);
    expect(plan.assign[renamed.index]).toBe(freeKeys[0]);
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

  it("uses a player's most frequent historical role when the replay has none", () => {
    const state = matchState();
    const replay = {
      players: [{ index: 0, gameName: "Ene", tagLine: "TFT", riotId: "Ene#TFT", champion: "Ahri", role: null, kills: 1, deaths: 2, assists: 3 }],
    };
    const history = [
      { match_key: "old-1", match_details: [{ player: "Ene#TFT", role: "Mid" }] },
      { match_key: "old-2", match_details: [{ player: "Ene#TFT", role: "Mid" }] },
      { match_key: "old-3", match_details: [{ player: "Ene#TFT", role: "Bot" }] },
      { match_key: "current", match_details: [{ player: "Ene#TFT", role: "Top" }] },
    ];
    const assign = { 0: slotKey(0, 1) };
    const form = applyReplayToForm(formFor(state), replay, assign, [], history, "current");
    expect(form.teams[0].players[1].role).toBe("Mid");
  });

  it("leaves a role blank when historical roles are tied and the champion doesn't settle it", () => {
    const state = matchState();
    // "Locke" has no history on the site and no built-in role, so nothing breaks the tie.
    const replay = {
      players: [{ index: 0, gameName: "Ene", tagLine: "TFT", riotId: "Ene#TFT", champion: "Locke", role: null, kills: 1, deaths: 2, assists: 3 }],
    };
    const history = [
      { match_key: "old-1", match_details: [{ player: "Ene#TFT", role: "Mid" }] },
      { match_key: "old-2", match_details: [{ player: "Ene#TFT", role: "Bot" }] },
    ];
    const assign = { 0: slotKey(0, 1) };
    const form = applyReplayToForm(formFor(state), replay, assign, [], history);
    expect(form.teams[0].players[1].role).toBe("");
  });

  it("lets the champion break a tie in a player's own history", () => {
    const state = matchState();
    const replay = {
      players: [{ index: 0, gameName: "Ene", tagLine: "TFT", riotId: "Ene#TFT", champion: "Ahri", role: null, kills: 1, deaths: 2, assists: 3 }],
    };
    const history = [
      { match_key: "old-1", match_details: [{ player: "Ene#TFT", role: "Mid" }] },
      { match_key: "old-2", match_details: [{ player: "Ene#TFT", role: "Bot" }] },
    ];
    const form = applyReplayToForm(formFor(state), replay, { 0: slotKey(0, 1) }, [], history);
    expect(form.teams[0].players[1].role).toBe("Mid");
  });

  it("never gives two players of a team the same role", () => {
    const state = matchState();
    const names = state.teams[0].players.map((p) => p.player);
    // Everyone's own history says Mid, and they are all on mid champions.
    const history = [{ match_key: "old", match_details: names.map((player) => ({ player, role: "Mid", champion: "Ahri" })) }];
    const replay = {
      players: names.map((name, index) => ({ index, gameName: name.split("#")[0], tagLine: name.split("#")[1], riotId: name, champion: "Ahri", role: null, kills: 1, deaths: 1, assists: 1 })),
    };
    const assign = Object.fromEntries(names.map((_, index) => [index, slotKey(0, index)]));
    const roles = Object.values(applyReplayToForm(formFor(state), replay, assign, [], history).teams[0].players.map((p) => p.role)).filter(Boolean);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it("guesses a team's roles together: players of settled roles are removed from the others' options", () => {
    const state = matchState();
    state.teams[0].players[0].role = "Mid"; // already decided by hand
    const replay = {
      players: [
        { index: 0, gameName: "Voidliss", tagLine: "NA1", riotId: "Voidliss#NA1", champion: "Ahri", role: null, kills: 1, deaths: 1, assists: 1 },
        { index: 1, gameName: "Ene", tagLine: "TFT", riotId: "Ene#TFT", champion: "Syndra", role: null, kills: 1, deaths: 1, assists: 1 },
      ],
    };
    const assign = { 0: slotKey(0, 0), 1: slotKey(0, 1) };
    const roles = resolveRoles(formFor(state), replay, assign, { roleHistory: [] });
    expect(roles[slotKey(0, 0)]).toBe("Mid"); // the form's own role is kept
    expect(roles[slotKey(0, 1)]).not.toBe("Mid"); // so another mid champion can't also be Mid
  });

  it("keeps roles the editor chose, even a deliberate blank, and can discard the form's own with ignoreExisting", () => {
    const state = matchState();
    state.teams[0].players[1].role = "Top";
    const replay = { players: [{ index: 0, gameName: "Ene", tagLine: "TFT", riotId: "Ene#TFT", champion: "Ahri", role: null, kills: 1, deaths: 1, assists: 1 }] };
    const assign = { 0: slotKey(0, 1) };
    const key = slotKey(0, 1);
    expect(resolveRoles(formFor(state), replay, assign, {})[key]).toBe("Top");
    expect(resolveRoles(formFor(state), replay, assign, { keep: { [key]: "Bot" } })[key]).toBe("Bot");
    expect(resolveRoles(formFor(state), replay, assign, { keep: { [key]: "" } })[key]).toBe("");
    expect(resolveRoles(formFor(state), replay, assign, { ignoreExisting: true })[key]).toBe("Mid"); // Ahri, not the stale Top
  });

  it("uses the roster slot's name, not the name as read, to find a player's history", () => {
    const state = matchState();
    // The reader garbled the name completely, but the editor matched it to Ene's slot.
    const replay = { players: [{ index: 0, gameName: "Xq7zz", tagLine: null, riotId: "Xq7zz", champion: "Locke", role: null, kills: 1, deaths: 1, assists: 1, ocr: true }] };
    const history = [
      { match_key: "o1", match_details: [{ player: "Ene#TFT", role: "Supp" }] },
      { match_key: "o2", match_details: [{ player: "Ene#TFT", role: "Supp" }] },
    ];
    const roles = resolveRoles(formFor(state), replay, { 0: slotKey(0, 1) }, { roleHistory: history });
    expect(roles[slotKey(0, 1)]).toBe("Supp");
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

describe("keeping the editor's work when an import is redone", () => {
  const state = matchState();
  const replay = {
    source: "screenshot",
    teams: [100, 200],
    players: [
      { index: 0, team: 100, gameName: "Voidliss", tagLine: null, champion: "ashe", role: null, kills: 6, deaths: 5, assists: 25, ocr: true },
      { index: 1, team: 100, gameName: "Ene", tagLine: null, champion: "ahri", role: null, kills: 13, deaths: 2, assists: 5, ocr: true },
    ],
  };
  const base = formFor(state);
  const withExtras = (form) => ({ ...form, resultSide: "team1", bans: { team1: ["Zed", ""], team2: ["", ""] } });

  it("leaves bans, the result and untouched slots as typed while refreshing imported ones", () => {
    const assign = { 0: slotKey(0, 0), 1: slotKey(0, 1) };
    const current = withExtras(applyReplayToForm(base, replay, assign, []));
    current.teams[0].players[4].champion = "Kled"; // typed by hand into a slot the import never fills
    current.teams[0].players[1].kills = "99"; // an imported slot: the import's value wins
    const fixed = { ...replay, players: replay.players.map((p) => (p.index === 1 ? { ...p, kills: 14 } : p)) };
    const next = reapplyReplay(current, base, fixed, assign, assign, [], { roles: { [slotKey(0, 0)]: "Bot", [slotKey(0, 1)]: "Mid" } });
    expect(next.bans).toEqual({ team1: ["Zed", ""], team2: ["", ""] });
    expect(next.resultSide).toBe("team1");
    expect(next.teams[0].players[4].champion).toBe("Kled");
    expect(next.teams[0].players[1]).toMatchObject({ kills: "14", role: "Mid" });
    expect(next.teams[0].players[0].role).toBe("Bot");
  });

  it("puts a slot back as it was when the import no longer fills it", () => {
    const before = { 0: slotKey(0, 0), 1: slotKey(0, 1) };
    const after = { 0: slotKey(0, 0), 1: null };
    const current = applyReplayToForm(base, replay, before, []);
    const next = reapplyReplay(current, base, replay, after, before, [], { roles: {} });
    expect(next.teams[0].players[1].champion).toBe("");
    expect(next.teams[0].players[0].champion).toBe("Ashe");
  });
});

describe("past names worth remembering", () => {
  const state = matchState();
  const replay = {
    source: "screenshot",
    players: [
      { index: 0, team: 100, gameName: "Lunar", tagLine: null, champion: "ashe", ocr: true },
      { index: 1, team: 100, gameName: "Ene", tagLine: null, champion: "ahri", ocr: true },
      { index: 2, team: 100, gameName: "Richgamebuddy", tagLine: null, champion: "ashe", ocr: true },
      { index: 3, team: 100, gameName: "Xq", tagLine: null, champion: "jinx", ocr: true },
    ],
  };
  const plan = { assign: { 0: slotKey(0, 0), 1: slotKey(0, 1), 2: slotKey(0, 2), 3: null } };

  it("offers only names that don't already belong to the slot they were matched to", () => {
    const found = pastNameCandidates(replay, plan, state, { 0: slotKey(0, 0) });
    expect(found).toEqual([
      { index: 0, key: slotKey(0, 0), name: "Lunar", tag: null, slotPlayer: "Voidliss#NA1", slotName: "Voidliss#NA1", confirmed: true },
    ]); // Ene and Richgamebuddy are the same names (up to case), Xq has no slot
  });

  it("marks an assignment the editor didn't make by hand as unconfirmed", () => {
    expect(pastNameCandidates(replay, plan, state, {})[0].confirmed).toBe(false);
    expect(pastNameCandidates(replay, plan, state, { 0: slotKey(1, 0) })[0].confirmed).toBe(false); // confirmed for a different slot
  });

  it("skips a name the roster player is already known by", () => {
    const known = matchState();
    known.teams[0].players[0].pastNames = ["Lunar"];
    expect(pastNameCandidates(replay, plan, known, { 0: slotKey(0, 0) })).toEqual([]);
  });

  it("carries the tag when the replay has one", () => {
    const tagged = { ...replay, players: [{ ...replay.players[0], tagLine: "OLD" }] };
    expect(pastNameCandidates(tagged, plan, state, {})[0]).toMatchObject({ name: "Lunar", tag: "OLD" });
  });
});
