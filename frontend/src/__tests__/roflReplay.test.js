import { describe, expect, it } from "vitest";
import { ReplayError, formatDuration, readReplayFile } from "../utils/roflReplay";
import { buildRofl, fixtureReplayFile, replays } from "./replayTestUtils";

const reject = (promise) => promise.then(() => null, (error) => error);

describe("readReplayFile", () => {
  it("reads the real 14.16 replay: names, champions, K/D/A, roles, winner", async () => {
    const replay = await readReplayFile(fixtureReplayFile("voidlissYeetor", "VOIDLISS_YEETOR.rofl"));
    expect(replay.version).toBe("14.16.609.8277");
    expect(replay.patch).toBe("14.16");
    expect(replay.teams).toEqual([100, 200]);
    expect(replay.winnerTeam).toBe(100);
    expect(replay.players).toHaveLength(10);
    expect(replay.hasNames && replay.hasRoles).toBe(true);
    expect(formatDuration(replay.durationMs)).toBe("29:38");

    const blue = replay.players.filter((p) => p.team === 100);
    expect(blue.map((p) => p.role)).toEqual(["Top", "Jungle", "Mid", "Bot", "Supp"]); // lane order
    expect(blue[3]).toMatchObject({ gameName: "Voidliss", tagLine: "", champion: "Ashe", kills: 6, deaths: 5, assists: 25, win: true });
    expect(replay.players.find((p) => p.gameName === "Ène")).toMatchObject({ champion: "Ahri", role: "Mid" });
  });

  it("prefers the full Riot ID of newer replays, whose NAME is blank", async () => {
    const replay = await readReplayFile(fixtureReplayFile("premadeVsRandoms", "NA1-5646135702.rofl"));
    expect(replay.patch).toBe("16.18");
    expect(replay.hasNames).toBe(true);
    const shen = replay.players.find((p) => p.champion === "Shen");
    expect(shen).toMatchObject({ gameName: "MENTAL MOUNTAIN", tagLine: "KEN", riotId: "MENTAL MOUNTAIN#KEN", role: "Top" });
  });

  it("treats 'Invalid' positions as no role information", async () => {
    const replay = await readReplayFile(fixtureReplayFile("noRoles", "NA1-5420391503.rofl"));
    expect(replay.hasRoles).toBe(false);
    expect(replay.players.every((p) => p.role === null)).toBe(true);
    expect(replay.players[0].champion).toBeTruthy();
  });

  it("marks a replay with blank names and no Riot IDs as having no names", async () => {
    const stats = replays.voidlissYeetor.stats.map((p) => ({ ...p, NAME: "", RIOT_ID_GAME_NAME: "" }));
    const replay = await readReplayFile(buildRofl({ stats }));
    expect(replay.hasNames).toBe(false);
    expect(replay.players[0].riotId).toBe("");
  });

  it("rejects files that are not replays, with a clear message", async () => {
    const notRofl = new File([new Uint8Array(200).fill(7)], "x.rofl");
    expect((await reject(readReplayFile(notRofl))).message).toMatch(/doesn't look like a League/);
    expect(await reject(readReplayFile(null))).toBeInstanceOf(ReplayError);
    expect((await reject(readReplayFile(new File([new Uint8Array(10)], "tiny.rofl")))).message).toMatch(/too small/);
  });

  it("rejects the older ROFL format", async () => {
    const legacy = new Uint8Array(300);
    legacy.set([0x52, 0x49, 0x4f, 0x54, 0x00, 0x00]);
    expect((await reject(readReplayFile(new File([legacy], "old.rofl")))).message).toMatch(/older replay format/);
  });

  it("rejects damaged files: bad length field, huge length, broken JSON", async () => {
    const good = await buildRofl({ stats: replays.voidlissYeetor.stats }).arrayBuffer();
    const bytes = new Uint8Array(good);
    const withLength = (value) => {
      const copy = bytes.slice();
      new DataView(copy.buffer).setUint32(copy.length - 4, value, true);
      return new File([copy], "bad.rofl");
    };
    for (const length of [0, 1, 0xffffffff, bytes.length]) {
      expect((await reject(readReplayFile(withLength(length)))).message).toMatch(/no match summary/);
    }
    const garbled = bytes.slice();
    garbled[garbled.length - 10] = 0xff; // not valid UTF-8 / JSON
    expect((await reject(readReplayFile(new File([garbled], "bad.rofl")))).message).toMatch(/damaged/);
  });

  it("rejects games that aren't two teams (e.g. Arena)", async () => {
    const stats = replays.voidlissYeetor.stats.map((p, i) => ({ ...p, TEAM: String(100 + (i % 4)) }));
    expect((await reject(readReplayFile(buildRofl({ stats })))).message).toMatch(/two-team/);
  });
});
