import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ProfileHistoryTable from "../components/shared/ProfileHistoryTable";
import DataTable from "../components/table/DataTable";

vi.mock("../components/shared/MatchDetailEditor", () => ({ default: () => null }));

describe("table pagination and profile history controls", () => {
  it.each([
    [39, ["40"], true],
    [41, ["40", "80"], false],
    [121, ["40", "80", "120", "All"], true],
  ])("limits profile history page sizes for %s games", (gameCount, expectedOptions, showPlayer) => {
    render(
      <MemoryRouter>
        <ProfileHistoryTable
          entries={Array.from({ length: gameCount }, (_, index) => ({ matchKey: `game-${index}`, outcome: "win", playerDetails: [] }))}
          showPlayer={showPlayer}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("button", { name: /^(?:\d+|All)$/ }).map((button) => button.textContent)).toEqual(expectedOptions);
  });

  it("supports profile history page entry and expanding every match", async () => {
    const user = userEvent.setup();
    const entries = Array.from({ length: 41 }, (_, index) => ({ matchKey: `game-${index}`, outcome: "win", playerDetails: [] }));
    render(
      <MemoryRouter>
        <ProfileHistoryTable entries={entries} />
      </MemoryRouter>,
    );

    const pageInput = screen.getByRole("textbox", { name: "Page number" });
    await user.clear(pageInput);
    await user.type(pageInput, "2");
    await user.keyboard("{Enter}");
    expect(document.querySelectorAll(".profile-history-table tbody > tr:not(.roster-detail-row)")).toHaveLength(1);
    expect(pageInput).toHaveValue("2");

    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(document.querySelectorAll(".profile-history-table tbody > tr.roster-detail-row")).toHaveLength(1);
  });

  it("adds direct page navigation to the Players-style data table", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 81 }, (_, index) => ({ name: `Player ${index + 1}` }));
    render(
      <DataTable
        columns={[{ key: "name", label: "Name", sortable: false, hideable: false, filterable: false }]}
        data={rows}
        ownerKey="pagination-test"
        pagination={{ pageSizeOptions: [40, 80, 120, "all"], defaultPageSize: 40 }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Last" }));
    expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("3");
    await user.click(screen.getByRole("button", { name: "First" }));
    expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1");
    await user.click(screen.getByRole("button", { name: "Next ›" }));
    expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
  });
});
