import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrueSkillValue } from "../components/shared/Cells";

describe("TrueSkillValue", () => {
  it("renders only the adjusted rating, even when a raw mu value is supplied", () => {
    const { container } = render(<TrueSkillValue rating={1200} mu={1400} />);
    expect(container.querySelector(".trueskill-cell").textContent).toBe("1200");
  });
});
