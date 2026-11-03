import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Meter, Progress, meterTone } from "./Meter";

describe("Meter", () => {
  it("exposes the value, range and words, and labels itself", () => {
    render(<Meter label="Storage" value={12} max={64} valueText="12 MB of 64 MB used" />);
    const meter = screen.getByRole("meter", { name: "Storage" });
    expect(meter).toHaveAttribute("aria-valuenow", "12");
    expect(meter).toHaveAttribute("aria-valuemax", "64");
    expect(meter).toHaveAttribute("aria-valuetext", "12 MB of 64 MB used");
    expect(meter).toHaveAttribute("data-tone", "accent");
    expect(screen.getByText("12 MB of 64 MB used")).toBeInTheDocument();
  });

  it("turns warning and danger past the thresholds", () => {
    expect(meterTone(0.5)).toBe("accent");
    expect(meterTone(0.8)).toBe("warning");
    expect(meterTone(0.95)).toBe("danger");
    expect(meterTone(0.6, { warning: 0.5, danger: 0.7 })).toBe("warning");
    render(
      <>
        <Meter label="A" value={85} />
        <Meter label="B" value={97} />
        <Meter label="C" value={97} thresholds={false} />
        <Meter label="D" value={200} max={100} />
      </>,
    );
    expect(screen.getByRole("meter", { name: "A" })).toHaveAttribute("data-tone", "warning");
    expect(screen.getByRole("meter", { name: "B" })).toHaveAttribute("data-tone", "danger");
    expect(screen.getByRole("meter", { name: "C" })).toHaveAttribute("data-tone", "accent");
    // Over-quota values are clamped for the bar and aria-valuenow.
    expect(screen.getByRole("meter", { name: "D" })).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("Progress", () => {
  it("is determinate with a value and indeterminate without", () => {
    render(
      <>
        <Progress label="Uploading" value={2} max={3} valueText="2 of 3 files" />
        <Progress label="Importing" />
      </>,
    );
    expect(screen.getByRole("progressbar", { name: "Uploading" })).toHaveAttribute("aria-valuenow", "2");
    const busy = screen.getByRole("progressbar", { name: "Importing" });
    expect(busy).not.toHaveAttribute("aria-valuenow");
    expect(busy).toHaveAttribute("aria-busy", "true");
  });
});
