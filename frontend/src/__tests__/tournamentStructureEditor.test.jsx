import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorApi } from "../api/client";
import TournamentStructureEditor from "../components/shared/TournamentStructureEditor";

const structure = {
  year: 2026,
  tournament: "Summer",
  stages: [{ stageId: "stage-1", name: "Group Stage", format: "round-robin", order: 1 }],
  series: [],
  games: [
    { matchKey: "match-1", matchOrder: 1, team1: "Alpha", team2: "Beta", stageId: "stage-1", stage: { stageName: "Group Stage" }, seriesId: null },
    { matchKey: "match-2", matchOrder: 2, team1: "Beta", team2: "Alpha", stageId: "stage-1", stage: { stageName: "Group Stage" }, seriesId: null },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TournamentStructureEditor", () => {
  it("groups explicitly selected games into a named best-of series", async () => {
    const user = userEvent.setup();
    const getStructure = vi.spyOn(editorApi, "getTournamentStructure").mockResolvedValue(structure);
    const createSeries = vi.spyOn(editorApi, "createSeries").mockResolvedValue({
      ...structure,
      series: [{
        seriesId: "series-1",
        stageId: "stage-1",
        roundLabel: "Final",
        bestOf: 3,
        games: structure.games,
      }],
    });
    const onChanged = vi.fn();
    render(
      <TournamentStructureEditor
        rows={[
          { year: 2026, tournament: "Summer" },
          { year: 2026, tournament: "Summer" },
        ]}
        onChanged={onChanged}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Tournament structure" });
    await waitFor(() => expect(getStructure).toHaveBeenCalledWith(2026, "Summer"));
    await user.click(within(dialog).getByRole("checkbox", { name: /#1 Alpha vs Beta/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: /#2 Beta vs Alpha/ }));
    fireEvent.change(within(dialog).getByLabelText("Round label"), { target: { value: "Final" } });
    await user.selectOptions(within(dialog).getByLabelText("Best of"), "3");
    await user.click(within(dialog).getByRole("button", { name: "Group selected games" }));

    await waitFor(() => expect(createSeries).toHaveBeenCalledWith(
      2026,
      "Summer",
      {
        matchKeys: ["match-1", "match-2"],
        stageId: "stage-1",
        roundLabel: "Final",
        bestOf: 3,
      },
      null,
    ));
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
