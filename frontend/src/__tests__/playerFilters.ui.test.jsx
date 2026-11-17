import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import TrueSkillTab from "../pages/TrueSkillTab";

const appData = vi.hoisted(() => ({ players: [], funFacts: {} }));

vi.mock("../context/AppDataContext", () => ({
  useAppData: () => appData,
}));

function player(identityKey, group, history) {
  return {
    identityKey,
    group,
    history,
    mu: 1000,
    sigma: 100,
    conservativeRating: 900,
    games: history.length,
    tournaments: 1,
    wins: history.filter((game) => game.outcome === "win").length,
    losses: history.filter((game) => game.outcome === "loss").length,
  };
}

function game(tournament, role, outcome, champion) {
  return {
    year: 2025,
    tournament,
    outcome,
    playerDetails: [{ role, champion }],
  };
}

function cellValue(row, label) {
  const table = row.closest("table");
  const column = [...table.querySelectorAll("thead th")].findIndex((header) => header.textContent.includes(label));
  return row.querySelectorAll("td")[column].textContent;
}

describe("Players tab game filters", () => {
  beforeEach(() => {
    appData.players = [
      player("p1", "TestPlayer#NA", [
        game("Summer", "Top", "win", "Ahri"),
        game("Summer", "Mid", "loss", "Ahri"),
        game("Winter", "Top", "loss", "Lux"),
      ]),
      player("p2", "OtherPlayer#NA", [game("Winter", "Top", "win", "Lux")]),
    ];
    appData.funFacts = { championDiversity: { minGames: 2, players: [] } };
  });

  it("shows statistics from only the selected tournament and role", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TrueSkillTab active />
      </MemoryRouter>,
    );

    await user.selectOptions(screen.getByLabelText("Filter by tournament"), "2025::Summer");
    await user.selectOptions(screen.getByLabelText("Filter by role"), "Top");

    const row = screen.getByRole("row", { name: /TestPlayer#NA/ });
    expect(cellValue(row, "Games")).toBe("1");
    expect(cellValue(row, "Tournaments")).toBe("1");
    expect(cellValue(row, "Wins")).toBe("1");
    expect(cellValue(row, "Losses")).toBe("0");
    expect(cellValue(row, "Win Rate")).toBe("100.0%");
    expect(screen.queryByRole("row", { name: /OtherPlayer#NA/ })).not.toBeInTheDocument();
  });
});
