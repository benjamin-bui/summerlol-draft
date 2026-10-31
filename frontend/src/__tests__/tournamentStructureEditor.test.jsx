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

  it("defines the number, names and team allocation of round-robin groups and saves them", async () => {
    const user = userEvent.setup();
    const rrStructure = {
      ...structure,
      stages: [{ stageId: "stage-1", name: "Group Stage", format: "round-robin", stageOrder: 1, groups: [] }],
      games: [
        { matchKey: "m1", matchOrder: 1, team1: "Alpha", team2: "Beta", stageId: "stage-1", stage: { stageName: "Group Stage" }, seriesId: null },
        { matchKey: "m2", matchOrder: 2, team1: "Gamma", team2: "Delta", stageId: "stage-1", stage: { stageName: "Group Stage" }, seriesId: null },
      ],
    };
    vi.spyOn(editorApi, "getTournamentStructure").mockResolvedValue(rrStructure);
    const save = vi.spyOn(editorApi, "saveTournamentStages").mockResolvedValue(rrStructure);
    render(
      <TournamentStructureEditor
        rows={[{ year: 2026, tournament: "Summer" }]}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Tournament structure" });
    const groups = await within(dialog).findByRole("group", { name: "Stage 1 groups" });
    expect(within(groups).getByText(/No groups/)).toBeInTheDocument();

    // Pick the count, then rename and allocate.
    fireEvent.change(within(groups).getByLabelText("Stage 1 number of groups"), { target: { value: "2" } });
    fireEvent.change(within(groups).getByLabelText("Stage 1 group 2 name"), { target: { value: "Blue" } });
    await user.selectOptions(within(groups).getByLabelText("Stage 1 group for Alpha"), "0");
    await user.selectOptions(within(groups).getByLabelText("Stage 1 group for Beta"), "0");
    await user.selectOptions(within(groups).getByLabelText("Stage 1 group for Gamma"), "1");
    expect(within(groups).getByText(/1 unassigned: Delta/)).toBeInTheDocument();
    // Reassigning moves a team rather than duplicating it.
    await user.selectOptions(within(groups).getByLabelText("Stage 1 group for Beta"), "1");
    await user.selectOptions(within(groups).getByLabelText("Stage 1 group for Delta"), "1");

    await user.click(within(dialog).getByRole("button", { name: "Save stages" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const sentStage = save.mock.calls[0][2][0];
    expect(sentStage.stageId).toBe("stage-1");
    expect(sentStage.groups).toEqual([
      { name: "Group A", teams: ["Alpha"] },
      { name: "Blue", teams: ["Gamma", "Beta", "Delta"] },
    ]);
  });

  it("suggests groups from the stage's games and hides the groups editor for other formats", async () => {
    const user = userEvent.setup();
    vi.spyOn(editorApi, "getTournamentStructure").mockResolvedValue({
      ...structure,
      stages: [
        { stageId: "stage-1", name: "Group Stage", format: "round-robin", stageOrder: 1, groups: [] },
        { stageId: "stage-2", name: "Playoffs", format: "single-elimination", stageOrder: 2, groups: [] },
      ],
      games: [
        { matchKey: "m1", matchOrder: 1, team1: "Alpha", team2: "Beta", stageId: "stage-1", stage: { stageName: "Group Stage" }, seriesId: null },
        { matchKey: "m2", matchOrder: 2, team1: "Gamma", team2: "Delta", stageId: "stage-1", stage: { stageName: "Group Stage" }, seriesId: null },
        { matchKey: "m3", matchOrder: 3, team1: "Alpha", team2: "Gamma", stageId: "stage-2", stage: { stageName: "Playoffs" }, seriesId: null },
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
    const groups = await within(dialog).findByRole("group", { name: "Stage 1 groups" });
    expect(within(dialog).queryByRole("group", { name: "Stage 2 groups" })).not.toBeInTheDocument();

    // Only the round-robin stage's own games count: the playoff game that
    // would link the two pairs together is ignored.
    await user.click(within(groups).getByRole("button", { name: "Suggest from games" }));
    expect(within(groups).getByLabelText("Stage 1 number of groups")).toHaveValue(2);
    expect(within(groups).getByLabelText("Stage 1 group for Alpha")).toHaveValue("0");
    expect(within(groups).getByLabelText("Stage 1 group for Beta")).toHaveValue("0");
    expect(within(groups).getByLabelText("Stage 1 group for Gamma")).toHaveValue("1");
    expect(within(groups).getByLabelText("Stage 1 group for Delta")).toHaveValue("1");

    // Switching the stage to another format hides the groups panel.
    await user.selectOptions(within(dialog).getByLabelText("Stage 1 format"), "swiss");
    expect(within(dialog).queryByRole("group", { name: "Stage 1 groups" })).not.toBeInTheDocument();
  });

  it("sets, auto-numbers and clears rounds on selected games", async () => {
    const user = userEvent.setup();
    const game = (key, order, team1, team2, round = null) => ({
      matchKey: key, matchOrder: order, team1, team2, stageId: "stage-1",
      stage: { stageName: "Group Stage" }, seriesId: null, round,
    });
    const roundsStructure = {
      ...structure,
      stages: [{ stageId: "stage-1", name: "Group Stage", format: "round-robin", stageOrder: 1, groups: [] }],
      games: [game("m1", 1, "Alpha", "Beta"), game("m2", 1, "Gamma", "Delta"), game("m3", 2, "Alpha", "Gamma", "Week 2")],
    };
    vi.spyOn(editorApi, "getTournamentStructure").mockResolvedValue(roundsStructure);
    const rounds = vi.spyOn(editorApi, "updateGameRounds").mockResolvedValue(roundsStructure);
    render(
      <TournamentStructureEditor rows={[{ year: 2026, tournament: "Summer" }]} onChanged={vi.fn()} onClose={vi.fn()} />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Tournament structure" });
    // An assigned round shows on the game's row.
    expect(await within(dialog).findByText(/Week 2/)).toBeInTheDocument();
    const pick = (name) => user.click(within(dialog).getByRole("checkbox", { name }));
    const button = (name) => within(dialog).getByRole("button", { name });

    expect(button("Set round on selected games")).toBeDisabled();
    expect(button("Clear round")).toBeDisabled();

    // Set one name on two games.
    await pick(/Alpha vs Beta/);
    await pick(/Gamma vs Delta/);
    await user.type(within(dialog).getByLabelText("Round name"), "  Week 1 ");
    await user.click(button("Set round on selected games"));
    await waitFor(() => expect(rounds).toHaveBeenCalledTimes(1));
    expect(rounds.mock.calls[0][2]).toEqual([
      { matchKey: "m1", round: "Week 1" },
      { matchKey: "m2", round: "Week 1" },
    ]);

    // Selection is cleared after a save; auto-number all three from match order.
    await pick(/Alpha vs Beta/);
    await pick(/Gamma vs Delta/);
    await pick(/Alpha vs Gamma/);
    await user.click(button("Number rounds from match order"));
    await waitFor(() => expect(rounds).toHaveBeenCalledTimes(2));
    expect(rounds.mock.calls[1][2]).toEqual([
      { matchKey: "m1", round: "Round 1" },
      { matchKey: "m2", round: "Round 1" },
      { matchKey: "m3", round: "Round 2" },
    ]);

    // Clearing is only offered for a selection that has a round.
    await pick(/Alpha vs Beta/);
    expect(button("Clear round")).toBeDisabled();
    await pick(/Alpha vs Gamma/);
    await user.click(button("Clear round"));
    await waitFor(() => expect(rounds).toHaveBeenCalledTimes(3));
    expect(rounds.mock.calls[2][2]).toEqual([
      { matchKey: "m1", round: null },
      { matchKey: "m3", round: null },
    ]);
  });

  it("sets the bracket section without touching the round", async () => {
    const user = userEvent.setup();
    const game = (key, order, team1, team2, extra = {}) => ({
      matchKey: key, matchOrder: order, team1, team2, stageId: "stage-1",
      stage: { stageName: "Playoffs" }, seriesId: null, round: null, section: null, ...extra,
    });
    const bracketStructure = {
      ...structure,
      stages: [{ stageId: "stage-1", name: "Playoffs", format: "double-elimination", stageOrder: 1, groups: [] }],
      games: [game("m1", 1, "Alpha", "Beta", { round: "Semifinals", section: "upper" }), game("m2", 2, "Gamma", "Delta")],
    };
    vi.spyOn(editorApi, "getTournamentStructure").mockResolvedValue(bracketStructure);
    const rounds = vi.spyOn(editorApi, "updateGameRounds").mockResolvedValue(bracketStructure);
    render(
      <TournamentStructureEditor rows={[{ year: 2026, tournament: "Summer" }]} onChanged={vi.fn()} onClose={vi.fn()} />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Tournament structure" });
    // Assigned round and section both show on the row.
    expect(await within(dialog).findByText(/Semifinals · Upper bracket/)).toBeInTheDocument();
    const button = within(dialog).getByRole("button", { name: "Set bracket section on selected games" });
    expect(button).toBeDisabled();
    await user.click(within(dialog).getByRole("checkbox", { name: /Gamma vs Delta/ }));
    await user.selectOptions(within(dialog).getByLabelText("Bracket section"), "lower");
    await user.click(button);
    await waitFor(() => expect(rounds).toHaveBeenCalledTimes(1));
    // Only the section is sent, so any existing round is kept by the server.
    expect(rounds.mock.calls[0][2]).toEqual([{ matchKey: "m2", section: "lower" }]);

    await user.click(within(dialog).getByRole("checkbox", { name: /Gamma vs Delta/ }));
    await user.selectOptions(within(dialog).getByLabelText("Bracket section"), "");
    await user.click(button);
    await waitFor(() => expect(rounds).toHaveBeenCalledTimes(2));
    expect(rounds.mock.calls[1][2]).toEqual([{ matchKey: "m2", section: null }]);
  });
});
