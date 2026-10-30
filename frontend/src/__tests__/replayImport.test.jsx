import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rawMatches from "../../test-fixtures/rawmatches.json";
import App from "../App";
import { matchOptions, opponentOptions } from "../utils/replayMatching";
import { buildRofl, fixtureReplayFile, replays } from "./replayTestUtils";

// Importing a replay: pick the match from the captains, then review what the
// replay filled in before saving. Everything here is editor-only.

const baseFetch = global.fetch;
const json = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });
const EDITOR = { enabled: true, authenticated: true, canEdit: true, user: { name: "Eddie" }, csrfToken: "csrf-123" };
const SIGNED_OUT = { enabled: true, authenticated: false, canEdit: false, user: null, csrfToken: null };

const MATCH_KEY = "match-2024-summer-groups-3-voidliss-na1-yeetor-0828";
const slot = (side, name, isCaptain = false) => ({
  side, player: name, displayName: name, isCaptain, champion: null, kills: null, deaths: null, assists: null, role: null,
});
const editorState = (matchKey) => ({
  matchKey,
  winnerSide: 1,
  teams: [
    { side: 1, name: "Voidliss#NA1", players: [slot(1, "Voidliss#NA1", true), ...["Ene#TFT", "RichGamebuddy#NA1", "Bloodyninja1122#NA1", "LightningFst#1008"].map((n) => slot(1, n))] },
    { side: 2, name: "Yeetor#0828", players: [slot(2, "Yeetor#0828", true), ...["Korobasne#NA1", "ricethesameater#NA1", "Brishin#bris", "NotElectro#3754"].map((n) => slot(2, n))] },
  ],
  bans: { team1: [], team2: [] },
  matchDetails: [],
  rev: "rev-1",
  roles: ["Top", "Jungle", "Mid", "Bot", "Supp"],
  maxBans: 5,
  championSuggestions: ["Ahri", "Miss Fortune"],
});

let calls;
function mockServer(me) {
  calls = [];
  global.fetch = vi.fn((url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
    if (u.startsWith("/api/auth/me")) return json(me);
    if (u.startsWith("/api/editor/")) {
      const key = decodeURIComponent(u.split("/api/editor/matches/")[1]);
      return (opts.method || "GET") === "PUT" ? json({ ...editorState(key), rev: "rev-2" }) : json(editorState(key));
    }
    return baseFetch(url, opts);
  });
}

async function renderMatchHistory() {
  render(
    <MemoryRouter initialEntries={["/?tab=matchdata"]}>
      <App />
    </MemoryRouter>,
  );
  await waitFor(() => expect(document.querySelector(".tab-panel.active .roster-toggle")).toBeTruthy(), { timeout: 10000 });
}
const upload = (label, file) => userEvent.upload(screen.getByLabelText(label, { selector: "input" }), file);
const optionTexts = (select) => within(select).getAllByRole("option").map((o) => o.textContent);

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  global.fetch = baseFetch;
  vi.restoreAllMocks();
});

describe("import entry points are editor-only", () => {
  it("shows neither the import button nor the in-editor upload to other visitors", async () => {
    for (const me of [{ ...SIGNED_OUT, enabled: false }, SIGNED_OUT]) {
      mockServer(me);
      await renderMatchHistory();
      expect(screen.queryByRole("button", { name: /import replay/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/replay file/i)).not.toBeInTheDocument();
      expect(calls.some((c) => c.url.startsWith("/api/editor/"))).toBe(false);
      document.body.innerHTML = "";
    }
  });
});

describe("importing a replay from the Match History tab", () => {
  it("lists the replay's players, narrows captains and matches, then fills the editor and saves", async () => {
    mockServer(EDITOR);
    await renderMatchHistory();
    await screen.findByRole("button", { name: /import replay/i });
    await upload("Replay file to import", fixtureReplayFile("voidlissYeetor", "VOIDLISS_YEETOR.rofl"));

    const dialog = await screen.findByRole("dialog", { name: /import replay/i });
    // Every player in the replay is shown.
    for (const name of ["Voidliss", "Ène", "geyouqianqiu", "Korobasne"]) {
      expect(within(dialog).getByText(name)).toBeInTheDocument();
    }
    expect(within(dialog).getByText(/Blue side \(100\) — won/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Continue to match editor/ })).toBeDisabled();
    // The roster fit is offered as a one-click suggestion.
    expect(within(dialog).getByRole("button", { name: new RegExp(`Voidliss#NA1 vs Yeetor#0828 \\(\\d+/10\\)`) })).toBeInTheDocument();

    // Captain 1 narrows captain 2 to the captains they have faced.
    const [captain1, captain2, match] = within(dialog).getAllByRole("combobox");
    const everyone = optionTexts(captain2).length;
    await userEvent.selectOptions(captain1, "Yeetor#0828");
    const expectedOpponents = opponentOptions(rawMatches.rows, "Yeetor#0828");
    expect(optionTexts(captain2).slice(1)).toEqual(expectedOpponents);
    expect(expectedOpponents.length + 1).toBeLessThan(everyone);

    // Both captains narrow the match list to their meetings (here: two).
    await userEvent.selectOptions(captain2, "Voidliss#NA1");
    const meetings = matchOptions(rawMatches.rows, "Yeetor#0828", "Voidliss#NA1");
    expect(meetings).toHaveLength(2);
    expect(optionTexts(match)).toHaveLength(3); // placeholder + 2 matches
    expect(within(dialog).getByRole("button", { name: /Continue to match editor/ })).toBeDisabled();
    await userEvent.selectOptions(match, MATCH_KEY);
    await userEvent.click(within(dialog).getByRole("button", { name: /Continue to match editor/ }));

    // The editor opens on that match with the replay already applied.
    const editor = await screen.findByRole("dialog", { name: /Edit match details/ });
    expect(await within(editor).findByLabelText("Ene#TFT champion")).toHaveValue("Ahri");
    expect(within(editor).getByLabelText("Ene#TFT kills")).toHaveValue(13);
    expect(within(editor).getByLabelText("Ene#TFT role")).toHaveValue("Mid");
    expect(within(editor).getByLabelText("Yeetor#0828 champion")).toHaveValue("Miss Fortune");
    expect(within(editor).getByLabelText("Brishin#bris role")).toHaveValue("Mid");
    // The two renamed players are left for a human.
    expect(within(editor).getByLabelText("ricethesameater#NA1 champion")).toHaveValue("");
    expect(within(editor).getByLabelText("NotElectro#3754 champion")).toHaveValue("");
    expect(within(editor).getByText(/2 replay player\(s\) couldn't be matched/)).toBeInTheDocument();
    expect(within(editor).queryByRole("alert")).not.toBeInTheDocument();

    // Assign the two leftovers by hand, then save.
    await userEvent.selectOptions(within(editor).getByLabelText("Roster slot for Lúnar"), "1:2");
    await userEvent.selectOptions(within(editor).getByLabelText("Roster slot for geyouqianqiu"), "1:4");
    expect(within(editor).getByLabelText("ricethesameater#NA1 champion")).toHaveValue("Ivern");
    expect(within(editor).getByLabelText("NotElectro#3754 champion")).toHaveValue("Senna");
    expect(within(editor).getByLabelText("NotElectro#3754 role")).toHaveValue("Supp");

    await userEvent.click(within(editor).getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const put = calls.find((c) => c.method === "PUT");
    expect(put.url).toContain(MATCH_KEY);
    expect(put.headers["X-CSRF-Token"]).toBe("csrf-123");
    const body = JSON.parse(put.body);
    expect(body.baseRev).toBe("rev-1");
    expect(body.players).toHaveLength(10);
    expect(body.players.find((p) => p.player === "Voidliss#NA1")).toEqual({
      player: "Voidliss#NA1", champion: "Ashe", kills: 6, deaths: 5, assists: 25, role: "Bot",
    });
    expect(body.players.find((p) => p.player === "NotElectro#3754")).toMatchObject({ champion: "Senna", kills: 2, deaths: 10, assists: 9, role: "Supp" });
    expect(body.bans).toEqual({ team1: [], team2: [] }); // replays have no bans
  });

  it("auto-selects the match when the two captains have met only once, and from a chosen match fills both captains", async () => {
    mockServer(EDITOR);
    await renderMatchHistory();
    const counts = new Map();
    for (const r of rawMatches.rows) {
      const k = [r.team1, r.team2].sort().join("|");
      counts.set(k, [...(counts.get(k) || []), r]);
    }
    const single = [...counts.values()].find((rows) => rows.length === 1)[0];

    await upload("Replay file to import", fixtureReplayFile("noRoles", "NA1-5420391503.rofl"));
    const dialog = await screen.findByRole("dialog", { name: /import replay/i });
    // This replay has no roles but does carry Riot IDs, so they are shown and
    // there is no "names hidden" warning.
    expect(within(dialog).getByText("vampire#teef")).toBeInTheDocument();
    expect(within(dialog).queryByText(/doesn.t include player names/)).not.toBeInTheDocument();
    const [captain1, captain2, match] = within(dialog).getAllByRole("combobox");
    await userEvent.selectOptions(captain1, single.team1);
    await userEvent.selectOptions(captain2, single.team2);
    expect(match).toHaveValue(single.match_key);
    expect(within(dialog).getByRole("button", { name: /Continue to match editor/ })).toBeEnabled();

    // Changing captain 1 to someone who never faced captain 2 clears the rest.
    const stranger = [...new Set(rawMatches.rows.flatMap((r) => [r.team1, r.team2]))].find(
      (c) => c !== single.team2 && !opponentOptions(rawMatches.rows, single.team2).includes(c),
    );
    await userEvent.selectOptions(captain1, stranger);
    expect(captain2).toHaveValue("");
    expect(match).toHaveValue("");

    // Picking a match first fills in both captains.
    await userEvent.selectOptions(captain1, "");
    await userEvent.selectOptions(match, MATCH_KEY);
    expect(captain1).toHaveValue("Voidliss#NA1");
    expect(captain2).toHaveValue("Yeetor#0828");
  });

  it("says so when a replay carries no player names at all", async () => {
    mockServer(EDITOR);
    await renderMatchHistory();
    const hidden = replays.voidlissYeetor.stats.map((p) => ({ ...p, NAME: "", RIOT_ID_GAME_NAME: "" }));
    await upload("Replay file to import", buildRofl({ stats: hidden, fileName: "hidden.rofl" }));
    const dialog = await screen.findByRole("dialog", { name: /import replay/i });
    expect(within(dialog).getAllByText("(name hidden)")).toHaveLength(10);
    expect(within(dialog).getByText(/doesn.t include player names/)).toBeInTheDocument();
    // No names means no roster suggestion either; the editor has to pick.
    expect(within(dialog).queryByText(/Rosters that fit this replay/)).not.toBeInTheDocument();
  });

  it("shows a clear message for a file that isn't a replay, and opens no dialog", async () => {
    mockServer(EDITOR);
    await renderMatchHistory();
    await upload("Replay file to import", new File([new Uint8Array(300).fill(1)], "notes.rofl"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/doesn't look like a League of Legends replay/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("warns, loudly, when the replay's winner contradicts the recorded result", async () => {
    mockServer(EDITOR);
    // Same replay, but the match is recorded as won by team 2.
    const flipped = replays.voidlissYeetor.stats.map((p) => ({ ...p, WIN: p.WIN === "Win" ? "Fail" : "Win" }));
    await renderMatchHistory();
    await upload("Replay file to import", buildRofl({ stats: flipped, fileName: "flipped.rofl" }));
    const dialog = await screen.findByRole("dialog", { name: /import replay/i });
    const [, , match] = within(dialog).getAllByRole("combobox");
    await userEvent.selectOptions(match, MATCH_KEY);
    await userEvent.click(within(dialog).getByRole("button", { name: /Continue to match editor/ }));
    const editor = await screen.findByRole("dialog", { name: /Edit match details/ });
    expect(await within(editor).findByRole("alert")).toHaveTextContent(/recorded as a win for Voidliss#NA1/);
  });
});

describe("importing a replay inside the match editor", () => {
  async function openEditor() {
    mockServer(EDITOR);
    await renderMatchHistory();
    await userEvent.click(document.querySelector(".tab-panel.active .roster-toggle"));
    await userEvent.click(await screen.findByRole("button", { name: /edit match details/i }));
    return screen.findByRole("dialog", { name: /Edit match details/ });
  }

  it("assumes the replay belongs to the open match, fills the form, and can swap the teams", async () => {
    const editor = await openEditor();
    expect(await within(editor).findByLabelText("Ene#TFT champion")).toHaveValue("");
    await userEvent.upload(
      within(editor).getByLabelText("Replay file", { selector: "input" }),
      fixtureReplayFile("voidlissYeetor", "VOIDLISS_YEETOR.rofl"),
    );
    expect(await within(editor).findByText("Imported from replay")).toBeInTheDocument();
    expect(within(editor).getByLabelText("Ene#TFT champion")).toHaveValue("Ahri");
    expect(within(editor).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: /save changes/i })).toBeEnabled();

    // Wrong team mapping: nothing lines up any more, and that is called out.
    await userEvent.click(within(editor).getByRole("button", { name: /swap teams/i }));
    const alerts = (await within(editor).findAllByRole("alert")).map((a) => a.textContent).join(" ");
    expect(alerts).toMatch(/None of the replay's player names match/);
    expect(alerts).toMatch(/recorded as a win for/); // the winner no longer fits either
    expect(within(editor).getByLabelText("Ene#TFT champion")).toHaveValue("");
    // Swapping back restores the import.
    await userEvent.click(within(editor).getByRole("button", { name: /swap teams/i }));
    await waitFor(() => expect(within(editor).getByLabelText("Ene#TFT champion")).toHaveValue("Ahri"));
  });

  it("reports an unreadable file without touching the form", async () => {
    const editor = await openEditor();
    await userEvent.upload(within(editor).getByLabelText("Replay file", { selector: "input" }), new File([new Uint8Array(300).fill(2)], "bad.rofl"));
    expect(await within(editor).findByRole("alert")).toHaveTextContent(/doesn't look like a League of Legends replay/);
    expect(within(editor).queryByText("Imported from replay")).not.toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: /save changes/i })).toBeDisabled();
  });
});
