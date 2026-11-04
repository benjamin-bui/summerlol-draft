import { describe, expect, it } from "vitest";
import {
  applyReplayToForm,
  championDisplayName,
  nameMatchStrength,
  ocrFold,
  ocrNamesMatch,
  planReplayImport,
  slotKey,
  suggestMatches,
} from "../utils/replayMatching";
import { OTHER_CHAMPION, championOptions, cropStyle, isSuggestedChampion, parseCount } from "../utils/screenshotReview";

describe("matching names read from a screenshot", () => {
  it("treats look-alike characters, spacing and accents as the same", () => {
    expect(ocrFold("ILove2FuttBuck")).toBe(ocrFold("lLove2FuttBuck"));
    expect(ocrFold("xxXTeem0MainXxx")).toBe(ocrFold("xxxTeemOMainxxx"));
    expect(ocrFold("Ène")).toBe(ocrFold("Ene"));
    expect(ocrFold("ass fuk")).toBe(ocrFold("assfuk"));
    expect(ocrNamesMatch("yaBuo", "yaßuo")).toBe(true);
    expect(ocrNamesMatch("Bloodyninja1l22", "Bloodyninja1122")).toBe(true);
  });

  it("allows about one slip in five characters in a long enough name, but never invents a match", () => {
    expect(ocrNamesMatch("yaguo", "yaßuo")).toBe(true); // one edit in five
    expect(ocrNamesMatch("kingofconquestlv", "kingofconquestiv")).toBe(true);
    expect(ocrNamesMatch("Kiny", "Kina")).toBe(false); // too short to tell
    expect(ocrNamesMatch("Voidliss", "Voidlass")).toBe(true);
    expect(ocrNamesMatch("Voidliss", "Yeetor")).toBe(false);
    expect(ocrNamesMatch("", "Voidliss")).toBe(false);
    expect(ocrNamesMatch("Brishin", "Brishop")).toBe(false); // two edits in seven
  });

  it("scores a close screenshot name between a tagless exact match and a different tag, only for screenshot players", () => {
    const read = { gameName: "Voidl1ss", tagLine: null, ocr: true };
    expect(nameMatchStrength(read, "Voidliss#NA1")).toBe(1.5);
    expect(nameMatchStrength({ ...read, gameName: "Voidliss" }, "Voidliss#NA1")).toBe(2); // exact still wins
    expect(nameMatchStrength({ ...read, ocr: undefined }, "Voidliss#NA1")).toBe(0); // replays are never matched loosely
    expect(nameMatchStrength({ ...read, gameName: "Zzzzzz" }, "Voidliss#NA1")).toBe(0);
  });

  const slot = (name) => ({ player: name, displayName: name, champion: "", kills: "", deaths: "", assists: "", role: "" });
  const state = {
    winnerSide: 1,
    championSuggestions: ["Miss Fortune", "Ahri"],
    teams: [
      { side: 1, name: "Voidliss#NA1", players: ["Voidliss#NA1", "Ene#TFT", "RichGamebuddy#NA1", "Bloodyninja1122#NA1", "LightningFst#1008"].map(slot) },
      { side: 2, name: "Yeetor#0828", players: ["Yeetor#0828", "Korobasne#NA1", "ricethesameater#NA1", "Brishin#bris", "NotElectro#3754"].map(slot) },
    ],
  };
  const read = (index, team, name, champion, kills, deaths, assists) => ({
    index, team, gameName: name, riotId: name, tagLine: null, champion, role: null, kills, deaths, assists, ocr: true,
  });
  const screenshot = {
    source: "screenshot",
    teams: [100, 200],
    winnerTeam: 100,
    hasNames: true,
    players: [
      read(0, 100, "Voidliss", "ashe", 6, 5, 25),
      read(1, 100, "Ene", "ahri", 13, 2, 5),
      read(2, 100, "RichGamebuddy", "missfortune", 4, 3, 9),
      read(3, 100, "BloodyninjalI22", "jinx", 2, 4, 8),
      read(4, 100, "LightningFst", "kled", 1, 2, 3),
      read(5, 200, "Yeetor", "darius", 3, 6, 4),
      read(6, 200, "Korobasne", "viego", 3, 6, 5),
      read(7, 200, "ricethesameater", "ivern", 1, 6, 2),
      read(8, 200, "Brishin", "lulu", 2, 7, 3),
      read(9, 200, "NotE1ectro", "senna", 2, 10, 9),
    ],
  };

  it("pairs every read name with its roster slot and fills the form from the screenshot", () => {
    const plan = planReplayImport(screenshot, state);
    expect(plan.assign[3]).toBe(slotKey(0, 3)); // Bloodyninja1122 despite l/I/1 slips
    expect(plan.assign[9]).toBe(slotKey(1, 4)); // NotElectro despite 1/l
    expect(Object.values(plan.assign).every(Boolean)).toBe(true);
    const form = applyReplayToForm({ teams: state.teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p })) })) }, screenshot, plan.assign, state.championSuggestions);
    const find = (name) => form.teams.flatMap((t) => t.players).find((p) => p.player === name);
    expect(find("Voidliss#NA1")).toMatchObject({ champion: "Ashe", kills: "6", deaths: "5", assists: "25" });
    // Roles aren't on a scoreboard, so they're guessed from the champions: one of each, never repeated.
    const team = form.teams[0].players.map((p) => p.role).filter(Boolean);
    expect(new Set(team).size).toBe(team.length);
    expect(find("RichGamebuddy#NA1")).toMatchObject({ champion: "Miss Fortune" }); // the site's own spelling
    expect(find("Bloodyninja1122#NA1")).toMatchObject({ champion: "Jinx", kills: "2" });
  });

  it("suggests the match whose rosters the read names fit", () => {
    const row = { match_key: "k", team1: "Voidliss#NA1", team2: "Yeetor#0828", _team1Roster: { roster: state.teams[0].players.map((p) => ({ displayName: p.displayName })) }, _team2Roster: { roster: state.teams[1].players.map((p) => ({ displayName: p.displayName })) } };
    const other = { match_key: "o", team1: "Someone#X", team2: "Else#Y", _team1Roster: { roster: [{ displayName: "Someone#X" }] }, _team2Roster: { roster: [{ displayName: "Else#Y" }] } };
    expect(suggestMatches(screenshot, [other, row])).toEqual([{ row, score: 10 }]);
  });

  it("when the winner is unknown the sides are still worked out from the names", () => {
    const plan = planReplayImport({ ...screenshot, winnerTeam: null }, state);
    expect(plan.swap ?? false).toBe(false);
  });
});

describe("champion names from icon keys", () => {
  it("prefers the spelling the site already uses", () => {
    expect(championDisplayName("missfortune", ["Miss Fortune"])).toBe("Miss Fortune");
    expect(championDisplayName("kaisa", ["Kai'Sa"])).toBe("Kai'Sa");
  });

  it("spells out the awkward ones otherwise, and capitalises the rest", () => {
    expect(championDisplayName("jarvaniv")).toBe("Jarvan IV");
    expect(championDisplayName("drmundo")).toBe("Dr. Mundo");
    expect(championDisplayName("monkeyking")).toBe("Wukong");
    expect(championDisplayName("nunu")).toBe("Nunu & Willump");
    expect(championDisplayName("jinx")).toBe("Jinx");
    expect(championDisplayName("jarvan iv")).toBe("Jarvan IV"); // typed by hand
    expect(championDisplayName("MissFortune")).toBe("Miss Fortune"); // replay-style ids are unchanged
  });
});

describe("screenshot review helpers", () => {
  it("shows just one region of the image, scaled to a height", () => {
    const style = cropStyle("blob:x", { width: 2000, height: 1000 }, { left: 100, top: 50, width: 200, height: 40 }, 20);
    expect(style).toMatchObject({ width: 100, height: 20, backgroundImage: 'url("blob:x")', backgroundSize: "1000px 500px", backgroundPosition: "-50px -25px" });
  });

  it("reads a typed K/D/A box as a whole number or nothing", () => {
    expect(parseCount("12")).toBe(12);
    expect(parseCount("0")).toBe(0);
    expect(parseCount("")).toBe(null);
    expect(parseCount("-3")).toBe(null);
    expect(parseCount("abc")).toBe(null);
    expect(parseCount("1000")).toBe(null);
    expect(parseCount("7.9")).toBe(7);
  });

  it("offers the reader's guesses with readable names, and knows when a champion was typed instead", () => {
    const player = { champion: "jarvaniv", review: { championChoices: [{ key: "jarvaniv", score: 0.9 }, { key: "leesin", score: 0.5 }] } };
    expect(championOptions(player)).toEqual([{ key: "jarvaniv", label: "Jarvan IV" }, { key: "leesin", label: "Lee Sin" }]);
    expect(isSuggestedChampion(player)).toBe(true);
    expect(isSuggestedChampion({ ...player, champion: "Teemo" })).toBe(false);
    expect(isSuggestedChampion({ ...player, champion: OTHER_CHAMPION })).toBe(false);
    expect(championOptions({ review: {} })).toEqual([]);
  });
});
