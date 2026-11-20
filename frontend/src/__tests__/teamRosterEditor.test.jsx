import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorApi } from "../api/client";
import TeamRosterEditor from "../components/shared/TeamRosterEditor";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TeamRosterEditor", () => {
  it("loads a draft roster, supports typed names and saves the revised order", async () => {
    const user = userEvent.setup();
    vi.spyOn(editorApi, "getTeamRoster").mockResolvedValue({
      captainKey: "captain-key",
      captainName: "Captain",
      baseRev: "rev-1",
      players: [{ name: "Alpha", pickOrder: 1 }],
    });
    const save = vi.spyOn(editorApi, "saveTeamRoster").mockResolvedValue({});
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <TeamRosterEditor
        year={2026}
        tournament="Summer"
        team={{ captainKey: "captain-key", captainName: "Captain" }}
        players={[{ group: "Alpha" }, { group: "Beta" }]}
        csrfToken="csrf"
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Edit roster for Captain" });
    expect(await within(dialog).findByLabelText("Pick 1")).toHaveValue("Alpha");
    await user.click(within(dialog).getByRole("button", { name: "Add player" }));
    await user.type(within(dialog).getByLabelText("Pick 2"), "New Player");
    expect(dialog.querySelector('datalist option[value="Beta"]')).not.toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Save roster" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(
      2026,
      "Summer",
      {
        captainKey: "captain-key",
        captainName: "Captain",
        baseRev: "rev-1",
        players: ["Alpha", "New Player"],
      },
      "csrf",
    ));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
