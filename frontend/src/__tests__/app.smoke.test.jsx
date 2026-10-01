import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";

// This suite renders the real app (with a real DOM via jsdom) against
// snapshots of the *actual* production API responses, and clicks through
// every tab plus a player profile page. Unlike the earlier logic-only smoke
// test, this exercises actual component mounting, effects, and re-renders --
// the closest thing to a real browser check available without a headless
// browser in this environment.

function renderApp(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App smoke test against real data", () => {
  it("loads the TrueSkill tab with real rows and no console errors", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderApp("/");
    // Wait for real player rows to appear (any known name from the fixture).
    expect((await screen.findAllByText(/Voidliss/i, {}, { timeout: 10000 })).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /Williams College Player Rankings/i })).toBeInTheDocument();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("TrueSkill tab links a player's name to their real profile, not the simple fallback", async () => {
    renderApp("/");
    const matches = await screen.findAllByText(/Voidliss/i, {}, { timeout: 10000 });
    // "Voidliss" also appears in the Fun Facts prose (not a link); find the
    // actual table-cell link specifically.
    const link = matches.map((el) => el.closest("a.player-link")).find(Boolean);
    expect(link).toBeTruthy();
    expect(link).toHaveAttribute("href", expect.stringMatching(/^\/player\/(?!simple\/)/));
  });

  it("switches to every tab without throwing, and shows real data", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderApp("/");
    await screen.findAllByText(/Voidliss/i, {}, { timeout: 10000 });

    // Every tab panel stays mounted (hidden via CSS) so each tab's own state
    // survives switching away and back -- but that means jsdom, which
    // doesn't apply our stylesheet, sees ALL of them as visible at once. So
    // scope each check to the panel that's actually .active, the same way a
    // real browser would only show that one.
    const activePanel = () => within(document.querySelector(".tab-panel.active"));
    const tabChecks = [
      ["Tournaments", () => activePanel().findByText("Summary", {}, { timeout: 10000 })],
      ["Draft vs. TrueSkill", () => activePanel().findByRole("heading", { name: "Draft IQ" }, { timeout: 10000 })],
      ["Team Balance", () => activePanel().findByRole("columnheader", { name: /Captain/ }, { timeout: 10000 })],
      ["Mock Draft", () => activePanel().findByRole("heading", { name: "Mock Draft" }, { timeout: 10000 })],
      ["Draft Data", () => activePanel().findByRole("columnheader", { name: /Player/ }, { timeout: 10000 })],
      ["Match History", () => activePanel().findByRole("columnheader", { name: /Tournament/ }, { timeout: 10000 })],
    ];
    for (const [label, check] of tabChecks) {
      const btn = screen.getByRole("button", { name: label });
      await user.click(btn);
      expect(await check()).toBeInTheDocument();
    }
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  }, 30000);

  it("Tournaments tab renders the selected tournament's teams and matches", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderApp("/?tab=tournaments");
    // Summary block heading always present once a tournament loads.
    await screen.findByText("Summary", {}, { timeout: 10000 });
    expect(screen.getByText("Team rosters")).toBeInTheDocument();
    expect(screen.getByText(/Matches/)).toBeInTheDocument();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("Draft IQ tab renders captain rows and opens the draft-history modal", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderApp("/?tab=draftiq");
    await screen.findByText("Draft IQ", {}, { timeout: 10000 });
    // Table should have at least one captain-draft-link.
    const links = await screen.findAllByRole("link", {}, { timeout: 10000 });
    const captainLink = links.find((l) => l.className.includes("captain-draft-link"));
    expect(captainLink).toBeTruthy();
    await user.click(captainLink);
    expect(await screen.findByText(/Draft History/)).toBeInTheDocument();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("Mock Draft tab defaults its pool to all players and can generate a board", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderApp("/?tab=mockdraft");
    await screen.findByRole("heading", { name: "Mock Draft" }, { timeout: 10000 });
    await screen.findByText(/Showing all/i, {}, { timeout: 10000 });
    const genBtn = screen.getByRole("button", { name: /Generate Board/i });
    await user.click(genBtn);
    expect(screen.getAllByText("Round 1").length).toBeGreaterThan(0);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("Player profile page loads real player data end to end", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderApp("/player/Voidliss-NA1");
    expect(await screen.findByText("Summary", {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tournaments" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "TrueSkill" })).toBeInTheDocument();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("Simple profile page renders for an unresolved name without crashing", async () => {
    renderApp("/player/simple/SomeRandomName-NA1");
    expect(await screen.findByText("SomeRandomName#NA1")).toBeInTheDocument();
  });
});

