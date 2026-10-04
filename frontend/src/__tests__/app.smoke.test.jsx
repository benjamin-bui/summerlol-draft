import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import ProfileHistoryTable from "../components/shared/ProfileHistoryTable";

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
  localStorage.removeItem("lol-draft-theme");
  document.documentElement.removeAttribute("data-theme");
});

describe("App smoke test against real data", () => {
  it.each([
    ["player", "/player/Voidliss-NA1"],
    ["champion", "/champion/syndra"],
  ])("applies the saved theme when opening a %s profile directly", async (_type, path) => {
    localStorage.setItem("lol-draft-theme", "light");
    renderApp(path);

    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));
  });

  it("loads the Players tab with real rows and no console errors", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderApp("/");
    // Wait for real player rows to appear (any known name from the fixture).
    expect((await screen.findAllByText(/Voidliss/i, {}, { timeout: 10000 })).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /Williams College Player Rankings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Players" })).toBeInTheDocument();
    expect(document.querySelector(".tab-panel.active .trueskill-ratings .trueskill-mu .rating-number")).toBeInTheDocument();
    expect(within(document.querySelector(".tab-panel.active")).queryByPlaceholderText("Search for a champion...")).not.toBeInTheDocument();
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

  it("searches champions from the Champions tab and opens the champion profile", async () => {
    const user = userEvent.setup();
    renderApp("/?tab=champions");
    const championPanel = within(document.querySelector("#tab-champions.active"));
    const input = championPanel.getByPlaceholderText("Search for a champion...");
    await user.type(input, "Syndra");
    const suggestion = await waitFor(() => {
      const element = document.querySelector("#tab-champions.active .trueskill-search-suggestion");
      expect(element).toBeInTheDocument();
      return element;
    });
    await user.click(suggestion);
    expect(await screen.findByText(/Games: 23/, {}, { timeout: 10000 })).toBeInTheDocument();
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
      ["Champions", () => activePanel().findByRole("columnheader", { name: /Champion/ }, { timeout: 10000 })],
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

  it("selects only the clicked tournament on the first click from all selected", async () => {
    const user = userEvent.setup();
    renderApp("/?tab=champions");
    const pickerButton = await screen.findByRole("button", { name: /All tournaments/ }, { timeout: 10000 });
    await user.click(pickerButton);

    const tournamentGroup = within(screen.getByRole("group", { name: "Filter tournaments" }));
    const chosen = tournamentGroup.getByRole("checkbox", { name: "Summer 2026" });
    await user.click(chosen);

    expect(chosen).toBeChecked();
    const second = tournamentGroup.getByRole("checkbox", { name: "Winter 2026" });
    expect(second).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Tournaments \(1\)/ })).toBeInTheDocument();

    await user.click(second);
    expect(second).toBeChecked();
    expect(screen.getByRole("button", { name: /Tournaments \(2\)/ })).toBeInTheDocument();
  }, 15000);

  it("closes the Champions tournament filter when clicking outside it", async () => {
    const user = userEvent.setup();
    renderApp("/?tab=champions");
    await user.click(await screen.findByRole("button", { name: /All tournaments/ }, { timeout: 10000 }));
    expect(screen.getByRole("group", { name: "Filter tournaments" })).toBeInTheDocument();

    await user.click(screen.getByRole("heading", { name: /Williams College Player Rankings/i }));
    expect(screen.queryByRole("group", { name: "Filter tournaments" })).not.toBeInTheDocument();
  }, 15000);

  it("links each champion in the Champions tab to its profile page", async () => {
    const user = userEvent.setup();
    renderApp("/?tab=champions");
    const championPanel = within(document.querySelector("#tab-champions.active"));
    await championPanel.findByRole("columnheader", { name: /Champion/ }, { timeout: 10000 });

    const link = document.querySelector("#tab-champions.active .champions-table-wrap a.champion-link");
    expect(link).toBeTruthy();
    expect(link).toHaveAttribute("href", expect.stringMatching(/^\/champion\/[a-z0-9]+$/));
    // Clicking the name navigates to the champion's page instead of expanding a dropdown.
    expect(document.querySelector("#tab-champions .roster-detail-row")).toBeNull();
    await user.click(link);
    expect(await screen.findByText("Summary", {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Players" })).toBeInTheDocument();
  }, 30000);

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
    expect(screen.queryByPlaceholderText("Search for a champion...")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "TrueSkill" })).toBeInTheDocument();
    const championsSection = screen.getByRole("heading", { name: "Champions" }).closest("section");
    expect(championsSection.querySelector("a.champion-link")).toHaveAttribute("href", expect.stringMatching(/^\/champion\//));
    // The player's expanded roster tables keep their TrueSkill column.
    await userEvent.setup().click(document.querySelector(".profile-history-table button.roster-toggle"));
    const rosterHeaders = [...document.querySelectorAll(".match-details-table")].map((t) => [...t.querySelectorAll("th")].map((th) => th.textContent));
    expect(rosterHeaders.length).toBe(2);
    for (const headers of rosterHeaders) expect(headers).toContain("TrueSkill");
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("Champion profile page shows summary, tournaments, players and a per-game history", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderApp("/champion/syndra");
    expect(await screen.findByText("Summary", {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search for a champion...")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tournaments" })).toBeInTheDocument();
    const playersHeading = screen.getByRole("heading", { name: "Players" });
    // Syndra's fixture has 23 games across several tournaments.
    expect(screen.getByText(/Games: 23/)).toBeInTheDocument();
    expect(screen.getByText("Role breakdown", { exact: false })).toBeInTheDocument();
    const matchupSection = screen.getByRole("heading", { name: "Champion Matchups" }).closest("section");
    const matchupTable = matchupSection.querySelector("table");
    expect([...matchupTable.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Role", "Enemy champion", "Games", "Win rate", "KDA"]);
    expect(matchupTable.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    expect(matchupTable.querySelector("tbody td:first-child img.role-icon")).toHaveAttribute("alt", expect.any(String));
    expect(screen.getByText("Highest win rate with")).toBeInTheDocument();
    expect(screen.getByText("Best win rate against overall")).toBeInTheDocument();
    expect(screen.getByText("Worst win rate against overall")).toBeInTheDocument();
    expect(screen.getByText("Best win rate against (Mid)")).toBeInTheDocument();
    expect(screen.getByText("Worst win rate against (Mid)")).toBeInTheDocument();

    // Left panel: no placement/pick columns, no TrueSkill or champion pick-rate tables.
    const sidebar = within(document.querySelector(".profile-sidebar"));
    expect(sidebar.queryByRole("columnheader", { name: "Placement" })).not.toBeInTheDocument();
    expect(sidebar.queryByRole("columnheader", { name: "Pick" })).not.toBeInTheDocument();
    expect(sidebar.queryByRole("heading", { name: "TrueSkill" })).not.toBeInTheDocument();
    expect(sidebar.queryByRole("heading", { name: "Champions" })).not.toBeInTheDocument();
    const playersTable = playersHeading.closest("section").querySelector("table");
    const playerHeaders = [...playersTable.querySelectorAll("th")].map((th) => th.textContent);
    expect(playerHeaders).toEqual(["Player", "Games", "Win rate", "Avg KDA"]);
    // Per-player games add up to the champion's total.
    const gamesTotal = [...playersTable.querySelectorAll("tbody tr")].reduce((sum, tr) => sum + Number(tr.children[1].textContent), 0);
    expect(gamesTotal).toBe(23);

    // Main panel: one history row per game, with the picking player in place of the champion.
    const history = document.querySelector(".profile-main .profile-history-table");
    expect(within(history).getByRole("columnheader", { name: "Player" })).toBeInTheDocument();
    expect(within(history).queryByRole("columnheader", { name: "Champion" })).not.toBeInTheDocument();
    expect(history.querySelectorAll("tbody > tr:not(.roster-detail-row)")).toHaveLength(23);
    expect(history.querySelector("tbody td a.player-link")).toBeTruthy();
    // Lane opponent's champion and K/D/A are shown; the picker's rating columns are not.
    expect(within(history).getByRole("columnheader", { name: "Lane Opponent" })).toBeInTheDocument();
    expect(within(history).getByRole("columnheader", { name: "Opponent Player" })).toBeInTheDocument();
    expect(within(history).getByRole("columnheader", { name: "Lane K/D/A" })).toBeInTheDocument();
    expect(within(history).queryByRole("columnheader", { name: "Avg Rating" })).not.toBeInTheDocument();
    expect(within(history).queryByRole("columnheader", { name: "TrueSkill" })).not.toBeInTheDocument();
    const headerCount = history.querySelectorAll("thead th").length;
    const firstRow = history.querySelector("tbody > tr:not(.roster-detail-row)");
    expect(firstRow.children).toHaveLength(headerCount);

    // Expanding a game shows both rosters without any TrueSkill (column or phone stats).
    await user.click(history.querySelector("button.roster-toggle"));
    const rosterTables = history.querySelectorAll(".match-details-table");
    expect(rosterTables).toHaveLength(2);
    for (const table of rosterTables) {
      const headers = [...table.querySelectorAll("th")].map((th) => th.textContent);
      expect(headers).toEqual(expect.arrayContaining(["Player", "Champion", "K", "D", "A"]));
      expect(headers).not.toContain("TrueSkill");
    }
    const extraLabels = [...history.querySelectorAll(".match-extra-stats span")].map((el) => el.textContent);
    expect(extraLabels).toEqual(expect.arrayContaining(["Captain", "Opponent"]));
    for (const rating of ["TrueSkill", "Change", "Team Avg", "Opp Avg"]) expect(extraLabels).not.toContain(rating);
    await user.click(history.querySelector("button.roster-toggle"));

    // Filtering by tournament narrows both the history and the players table.
    const select = document.querySelector(".tournament-filter-select");
    const firstTournament = select.querySelectorAll("option")[1];
    await user.selectOptions(select, firstTournament.value);
    const rows = history.querySelectorAll("tbody > tr:not(.roster-detail-row)").length;
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(23);

    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  }, 30000);

  it("links the lane opponent player name in champion history", () => {
    render(
      <MemoryRouter>
        <ProfileHistoryTable
          entries={[
            {
              player: { identityKey: "picker", displayName: "Picker#NA1" },
              playerDetails: [{ role: "Bot", kills: 8, deaths: 1, assists: 4 }],
              laneOpponent: {
                champion: "Syndra",
                key: "syndra",
                role: "Bot",
                player: { identityKey: "opponent", displayName: "Opponent#NA1" },
                kills: 2,
                deaths: 5,
                assists: 3,
              },
              outcome: "win",
              predictedWinProb: 0.5,
              ownTeam: { name: "Alpha", roster: [] },
              opponentTeam: { name: "Beta", roster: [] },
            },
          ]}
          showRole
          showPlayer
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Opponent#NA1" })).toHaveAttribute("href", "/player/Opponent-NA1");
  });

  it("Simple profile page renders for an unresolved name without crashing", async () => {
    renderApp("/player/simple/SomeRandomName-NA1");
    expect(await screen.findByText("SomeRandomName#NA1")).toBeInTheDocument();
  });
});

