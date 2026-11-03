import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

// Importing a screenshot of the post-game scoreboard from the Match History
// tab: the server reads it (stubbed here), the editor reviews and corrects the
// result, picks the match, and the corrected values land in the match editor.

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

// What the server returns for a read screenshot (names as OCR would give them).
const box = { left: 10, top: 10, width: 100, height: 30 };
function player(index, team, name, champion, [kills, deaths, assists], { confident = true, alternatives = [], kdaOk = true } = {}) {
  return {
    index, team, gameName: name, riotId: name, tagLine: null, champion, role: null, kills, deaths, assists, win: team === 100, ocr: true,
    review: {
      championConfident: confident,
      championChoices: [champion, ...alternatives].map((key, rank) => ({ key, score: 0.9 - rank * 0.1 })),
      kdaOk,
      boxes: { portrait: { ...box, width: 30, height: 30 }, name: box, kda: { ...box, width: 120 } },
    },
  };
}
const SUMMARY = {
  source: "screenshot",
  version: null,
  patch: null,
  durationMs: 2072000,
  teams: [100, 200],
  winnerTeam: 100,
  hasRoles: false,
  hasNames: true,
  image: { width: 1029, height: 606 },
  checks: [{ level: "notice", text: "This screenshot is small, so readings are less reliable. Check every value." }],
  players: [
    player(0, 100, "Voidliss", "ashe", [6, 5, 25]),
    player(1, 100, "Ene", "ahri", [13, 2, 5]),
    player(2, 100, "RichGamebuddy", "missfortune", [4, 3, 9]),
    player(3, 100, "BloodyninjalI22", "jinx", [2, 4, 8]),
    player(4, 100, "LightningFst", "kled", [1, 2, 3], { confident: false, alternatives: ["kayn", "urgot"] }),
    player(5, 200, "Yeetor", "darius", [3, 6, 4]),
    player(6, 200, "Korobasne", "viego", [3, 6, 5]),
    player(7, 200, "ricethesameater", "ivern", [1, 6, 2]),
    player(8, 200, "Brishin", "lulu", [2, 7, 3]),
    player(9, 200, "NotE1ectro", "senna", [2, 10, 9]),
  ],
};

let calls;
function mockServer(me, screenshot = () => json(SUMMARY)) {
  calls = [];
  global.fetch = vi.fn((url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
    if (u.startsWith("/api/auth/me")) return json(me);
    if (u === "/api/editor/screenshot-parse") return screenshot(opts);
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
const png = (name = "board.png", type = "image/png", bytes = 64) => new File([new Uint8Array(bytes)], name, { type });
const upload = (file) => userEvent.upload(screen.getByLabelText("Screenshot to import", { selector: "input" }), file);

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  // jsdom has no object URLs; the dialog shows the screenshot through one.
  URL.createObjectURL = vi.fn(() => "blob:screenshot");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  global.fetch = baseFetch;
  vi.restoreAllMocks();
});

describe("the screenshot import is editor-only", () => {
  it("is not offered to other visitors", async () => {
    for (const me of [{ ...SIGNED_OUT, enabled: false }, SIGNED_OUT]) {
      mockServer(me);
      await renderMatchHistory();
      expect(screen.queryByRole("button", { name: /import screenshot/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Screenshot to import")).not.toBeInTheDocument();
      expect(calls.some((c) => c.url.includes("screenshot-parse"))).toBe(false);
      document.body.innerHTML = "";
    }
  });
});

describe("importing a screenshot from the Match History tab", () => {
  it("sends the image, shows what was read for review, and carries the corrections into the editor", async () => {
    mockServer(EDITOR);
    await renderMatchHistory();
    await screen.findByRole("button", { name: /import screenshot/i });
    const file = png();
    await upload(file);

    // It is sent as the raw image, with the CSRF token.
    const request = calls.find((c) => c.url === "/api/editor/screenshot-parse");
    expect(request.method).toBe("POST");
    expect(request.headers["Content-Type"]).toBe("image/png");
    expect(request.headers["X-CSRF-Token"]).toBe("csrf-123");
    expect(request.body).toBe(file);

    const dialog = await screen.findByRole("dialog", { name: "Import screenshot" });
    expect(within(dialog).getByText(/Read from a screenshot/)).toBeInTheDocument();
    expect(within(dialog).getByText(/This screenshot is small/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Blue side \(100\) — won/)).toBeInTheDocument();
    expect(within(dialog).getByText(/board\.png/)).toBeInTheDocument();
    // What was read is editable, with a crop of the screenshot beside each row.
    expect(within(dialog).getByLabelText("Player 1 name")).toHaveValue("Voidliss");
    expect(within(dialog).getByLabelText("Player 1 champion")).toHaveValue("ashe");
    expect(within(dialog).getByLabelText("Player 4 kills")).toHaveValue(2);
    expect(within(dialog).getAllByRole("img", { name: /portrait on the screenshot/ })).toHaveLength(10);
    // One champion the reader wasn't sure of is flagged, with its guesses offered.
    expect(within(dialog).getAllByText("check")).toHaveLength(1);
    const unsure = within(dialog).getByLabelText("Player 5 champion");
    expect(within(unsure).getAllByRole("option").map((o) => o.textContent)).toEqual(["Kled", "Kayn", "Urgot", "Other…"]);
    // Numbers that add up to the totals are marked as checked.
    expect(within(dialog).getAllByTitle(/add up to the scoreboard/)).toHaveLength(10);

    // The roster that fits is suggested even though several names were misread.
    const suggestion = within(dialog).getByRole("button", { name: /Voidliss#NA1 vs Yeetor#0828 \(10\/10\)/ });

    // Correct the champion (pick from the guesses), another by typing, and a K/D/A number.
    await userEvent.selectOptions(unsure, "kayn");
    expect(within(dialog).queryByText("check")).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText("Player 9 champion"), "Other…");
    await userEvent.type(within(dialog).getByLabelText("Player 9 champion name"), "Teemo");
    const kills = within(dialog).getByLabelText("Player 3 kills");
    await userEvent.clear(kills);
    await userEvent.type(kills, "14");
    // Editing a number means the team totals can no longer vouch for that team.
    expect(within(dialog).getAllByTitle(/add up to the scoreboard/).length).toBeLessThan(10);

    await userEvent.click(suggestion);
    await userEvent.click(within(dialog).getByRole("button", { name: /Continue to match editor/ }));

    // The match editor opens with the corrected values pre-filled; roles are left for a human.
    const editor = await screen.findByRole("dialog", { name: /Edit match details/ });
    expect(await within(editor).findByLabelText("Voidliss#NA1 champion")).toHaveValue("Ashe");
    expect(within(editor).getByLabelText("Voidliss#NA1 kills")).toHaveValue(6);
    expect(within(editor).getByLabelText("RichGamebuddy#NA1 champion")).toHaveValue("Miss Fortune");
    expect(within(editor).getByLabelText("RichGamebuddy#NA1 kills")).toHaveValue(14); // the correction
    expect(within(editor).getByLabelText("Bloodyninja1122#NA1 champion")).toHaveValue("Jinx"); // l/I/1 misread name still paired
    expect(within(editor).getByLabelText("LightningFst#1008 champion")).toHaveValue("Kayn");
    expect(within(editor).getByLabelText("Brishin#bris champion")).toHaveValue("Teemo"); // typed in
    expect(within(editor).getByLabelText("NotElectro#3754 champion")).toHaveValue("Senna");
    expect(within(editor).getByLabelText("Voidliss#NA1 role")).toHaveValue("Bot");

    await userEvent.click(within(editor).getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const put = calls.find((c) => c.method === "PUT");
    expect(put.url).toContain(MATCH_KEY);
    const body = JSON.parse(put.body);
    expect(body.players.find((p) => p.player === "RichGamebuddy#NA1")).toMatchObject({ champion: "Miss Fortune", kills: 14, deaths: 3, assists: 9 });
    expect(body.players.find((p) => p.player === "Brishin#bris")).toMatchObject({ champion: "Teemo", kills: 2 });
    // The preview image is released once the dialog is gone.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:screenshot");
  });

  it("explains when the server can't read the picture, opens no dialog, and lets the editor try again", async () => {
    mockServer(EDITOR, () => json({ error: "Couldn't find the scoreboard. Use a screenshot of the post-game Scoreboard tab.", code: "no-scoreboard" }, 422));
    await renderMatchHistory();
    await upload(png());
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't find the scoreboard/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import screenshot/i })).toBeEnabled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("refuses the wrong kind of file, or one that's too big, without uploading it", async () => {
    mockServer(EDITOR);
    await renderMatchHistory();
    await screen.findByRole("button", { name: /import screenshot/i });
    // userEvent.upload honours `accept`, so drive the input directly like a picker that doesn't.
    const input = screen.getByLabelText("Screenshot to import", { selector: "input" });
    const pick = async (file) => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    await pick(new File(["hello"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/PNG, JPEG or WebP/);
    const huge = png("huge.png", "image/png", 16);
    Object.defineProperty(huge, "size", { value: 9 * 1024 * 1024 });
    await pick(huge);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/larger than 8 MB/));
    expect(calls.some((c) => c.url.includes("screenshot-parse"))).toBe(false);
  });

  it("shows the server's message when reading is busy or unavailable", async () => {
    mockServer(EDITOR, () => json({ error: "Another screenshot is being read. Try again in a few seconds.", code: "busy" }, 429));
    await renderMatchHistory();
    await upload(png());
    expect(await screen.findByRole("alert")).toHaveTextContent(/Another screenshot is being read/);
  });

  it("shows progress while the screenshot is being read", async () => {
    let finish;
    mockServer(EDITOR, () => new Promise((resolve) => { finish = () => resolve({ ok: true, status: 200, json: () => Promise.resolve(SUMMARY) }); }));
    await renderMatchHistory();
    await upload(png());
    const busy = await screen.findByRole("button", { name: /reading screenshot/i });
    expect(busy).toBeDisabled();
    finish();
    await screen.findByRole("dialog", { name: "Import screenshot" });
    expect(screen.getByRole("button", { name: /import screenshot/i })).toBeEnabled();
  });

  it("flags a team whose numbers don't add up to the totals, in the reader's own words", async () => {
    const summary = {
      ...SUMMARY,
      checks: [{ level: "alert", text: "Team 1's kills don't add up to the scoreboard's totals (29/24/72). Check that team's numbers." }],
      players: SUMMARY.players.map((p) => (p.team === 100 ? { ...p, review: { ...p.review, kdaOk: false } } : p)),
    };
    mockServer(EDITOR, () => json(summary));
    await renderMatchHistory();
    await upload(png());
    const dialog = await screen.findByRole("dialog", { name: "Import screenshot" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/Team 1's kills don't add up/);
    // Only the other team is marked as checked.
    expect(within(dialog).getAllByTitle(/add up to the scoreboard/)).toHaveLength(5);
    expect(within(dialog).getByLabelText("Player 1 kills")).toHaveClass("is-unsure");
    expect(within(dialog).getByLabelText("Player 6 kills")).not.toHaveClass("is-unsure");
  });
});
