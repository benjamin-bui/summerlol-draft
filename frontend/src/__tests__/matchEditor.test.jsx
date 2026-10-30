import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

// The editor controls must be invisible to everyone but signed-in editors,
// and a signed-in editor's saves must carry the CSRF token. (The server is the
// real gatekeeper; these tests cover what the page shows and sends.)

const baseFetch = global.fetch;
const json = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });

const SIGNED_OUT = { enabled: true, authenticated: false, canEdit: false, user: null, csrfToken: null };
const EDITOR = {
  enabled: true,
  authenticated: true,
  canEdit: true,
  user: { name: "Eddie", email: "eddie@example.com" },
  csrfToken: "csrf-123",
};

function editorState(matchKey) {
  const player = (name, extra = {}) => ({
    side: 1, player: name, displayName: name, isCaptain: false,
    champion: null, kills: null, deaths: null, assists: null, role: null, ...extra,
  });
  return {
    matchKey,
    teams: [
      { side: 1, name: "Cap1", players: [player("Cap1", { isCaptain: true, champion: "Ahri", kills: 1, deaths: 2, assists: 3, role: "Mid" }), player("A1")] },
      { side: 2, name: "Cap2", players: [player("Cap2", { side: 2, isCaptain: true }), player("B1", { side: 2 })] },
    ],
    bans: { team1: [], team2: [{ champion: "Zed", key: "zed" }] },
    matchDetails: [{ matchKey, player: "Cap1", champion: "Ahri", kills: 1, deaths: 2, assists: 3, role: "Mid", championKey: "ahri" }],
    rev: "rev-1",
    roles: ["Top", "Jungle", "Mid", "Bot", "Supp"],
    maxBans: 5,
    championSuggestions: ["Ahri", "Zed"],
  };
}

let calls;
function mockServer({ me, editorGet, editorPut }) {
  calls = [];
  global.fetch = vi.fn((url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
    if (u.startsWith("/api/auth/me")) return json(me);
    if (u.startsWith("/api/editor/")) {
      if ((opts.method || "GET") === "PUT") return editorPut(u, opts);
      return editorGet(u, opts);
    }
    return baseFetch(url, opts);
  });
}

async function openFirstMatch(path = "/?tab=matchdata") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  const toggle = await waitFor(
    () => {
      const el = document.querySelector(".tab-panel.active .roster-toggle");
      expect(el).toBeTruthy();
      return el;
    },
    { timeout: 10000 },
  );
  await userEvent.click(toggle);
}

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  global.fetch = baseFetch;
  vi.restoreAllMocks();
});

describe("match editor visibility", () => {
  it("shows no editor controls to an ordinary visitor and never calls the editor API", async () => {
    mockServer({ me: { ...SIGNED_OUT, enabled: false }, editorGet: () => json({}, 500), editorPut: () => json({}, 500) });
    await openFirstMatch();
    expect(screen.queryByRole("button", { name: /edit match details/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/editor sign-in/i)).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/editor/"))).toBe(false);
  });

  it("offers sign-in, but still no editing, to a signed-out visitor when login is on", async () => {
    mockServer({ me: SIGNED_OUT, editorGet: () => json({}, 500), editorPut: () => json({}, 500) });
    await openFirstMatch();
    const link = await screen.findByRole("link", { name: /editor sign-in/i });
    expect(link.getAttribute("href")).toBe(`/auth/login?returnTo=${encodeURIComponent("/?tab=matchdata")}`);
    expect(screen.queryByRole("button", { name: /edit match details/i })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/editor/"))).toBe(false);
  });

  it("explains a refused sign-in without granting anything", async () => {
    mockServer({ me: SIGNED_OUT, editorGet: () => json({}, 500), editorPut: () => json({}, 500) });
    await openFirstMatch("/?tab=matchdata&login=denied");
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't on the editors list/i);
    expect(screen.queryByRole("button", { name: /edit match details/i })).not.toBeInTheDocument();
  });
});

describe("match editor for a signed-in editor", () => {
  it("edits a match and saves with the CSRF token, then reflects the saved data", async () => {
    let matchKey;
    mockServer({
      me: EDITOR,
      editorGet: (u) => {
        matchKey = decodeURIComponent(u.split("/api/editor/matches/")[1]);
        return json(editorState(matchKey));
      },
      editorPut: () => {
        const saved = editorState(matchKey);
        saved.matchDetails = [{ matchKey, player: "A1", champion: "Lux", kills: 4, deaths: 5, assists: 6, role: "Mid", championKey: "lux" }];
        saved.bans = { team1: [{ champion: "Yasuo", key: "yasuo" }], team2: [] };
        saved.rev = "rev-2";
        return json(saved);
      },
    });
    await openFirstMatch();
    expect(await screen.findByText(/editing as/i)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /edit match details/i }));

    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: /save changes/i });
    expect(await within(dialog).findByLabelText("A1 champion")).toBeInTheDocument();
    expect(save).toBeDisabled(); // nothing changed yet

    await userEvent.type(within(dialog).getByLabelText("A1 champion"), "Lux");
    await userEvent.type(within(dialog).getByLabelText("A1 kills"), "4");
    await userEvent.selectOptions(within(dialog).getByLabelText("A1 role"), "Mid");
    await userEvent.type(within(dialog).getByLabelText("Cap1 ban 1"), "Yasuo");
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const put = calls.find((c) => c.method === "PUT");
    expect(put.headers["X-CSRF-Token"]).toBe("csrf-123");
    const body = JSON.parse(put.body);
    expect(body.baseRev).toBe("rev-1");
    expect(body.players.find((p) => p.player === "A1")).toEqual({
      player: "A1", champion: "Lux", kills: 4, deaths: null, assists: null, role: "Mid",
    });
    expect(body.bans).toEqual({ team1: ["Yasuo"], team2: ["Zed"] });
  });

  it("lists the server's validation problems by player and keeps the form open", async () => {
    mockServer({
      me: EDITOR,
      editorGet: (u) => json(editorState(decodeURIComponent(u.split("/api/editor/matches/")[1]))),
      editorPut: () =>
        json({ error: "Invalid match details", problems: [{ field: "players[1].kills", message: "Kills must be a whole number from 0 to 99" }] }, 400),
    });
    await openFirstMatch();
    await userEvent.click(await screen.findByRole("button", { name: /edit match details/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(await within(dialog).findByLabelText("A1 kills"), "7");
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));
    expect(await within(dialog).findByText("A1: Kills must be a whole number from 0 to 99")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows a sign-in-again message instead of a form if the server refuses the editor", async () => {
    mockServer({ me: EDITOR, editorGet: () => json({ error: "Sign in required" }, 401), editorPut: () => json({}, 401) });
    await openFirstMatch();
    await userEvent.click(await screen.findByRole("button", { name: /edit match details/i }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/sign in again/i);
    expect(within(dialog).queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
  });
});
