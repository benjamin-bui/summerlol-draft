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
    { matchKey: "match-3", matchOrder: 3, team1: "Alpha", team2: "Beta", stageId: "stage-2", stage: { stageName: "Playoffs" }, seriesId: null },
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

  it("filters game selection by stage and provides clear-selection and select-all controls", async () => {
    const user = userEvent.setup();
    vi.spyOn(editorApi, "getTournamentStructure").mockResolvedValue({
      ...structure,
      stages: [
        ...structure.stages,
        { stageId: "stage-2", name: "Playoffs", format: "single-elimination", order: 2 },
      ],
    });
    render(
      <TournamentStructureEditor
        rows={[{ year: 2026, tournament: "Summer" }]}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Tournament structure" });
    const stageFilter = within(dialog).getByLabelText("Show games");
    await user.selectOptions(stageFilter, "stage-2");
    expect(within(dialog).getByText(/#3 Alpha vs Beta/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/#1 Alpha vs Beta/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/#2 Beta vs Alpha/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Select all shown" }));
    expect(within(dialog).getByText("1 selected · 1 shown")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Clear selection" }));
    expect(within(dialog).getByText("0 selected · 1 shown")).toBeInTheDocument();
  });

  it("uses captain names and current wins in the add-game result choices", async () => {
    const user = userEvent.setup();
    vi.spyOn(editorApi, "getTournamentStructure").mockResolvedValue({
      ...structure,
      series: [{
        seriesId: "series-final",
        stageId: "stage-1",
        roundLabel: "Final",
        bestOf: 3,
        games: [
          { matchKey: "match-1", team1: "Alpha Captain", team2: "Beta Captain", result: "Alpha Captain", gameNumber: 1 },
          { matchKey: "match-2", team1: "Beta Captain", team2: "Alpha Captain", result: "Beta Captain", gameNumber: 2 },
        ],
      }],
    });
    render(
      <TournamentStructureEditor
        rows={[{ year: 2026, tournament: "Summer" }]}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Tournament structure" });
    await user.selectOptions(within(dialog).getByLabelText("Result"), "team2");
    const resultSelect = within(dialog).getByLabelText("Result");
    expect(within(resultSelect).getByRole("option", { name: "Alpha Captain wins (1 win)" })).toBeInTheDocument();
    expect(within(resultSelect).getByRole("option", { name: "Beta Captain wins (1 win)" })).toBeInTheDocument();
    expect(within(dialog).getByText("Current score: Alpha Captain 1–1 Beta Captain")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Series")).toHaveTextContent("Alpha Captain 1–1 Beta Captain");
  });
});
