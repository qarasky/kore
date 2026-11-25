import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";
import { Field } from "./Field";
import { Input, Textarea } from "./Input";
import { Select } from "./Select";
import { Switch } from "./Switch";

describe("Field", () => {
  it("labels the control and describes it with the hint", () => {
    render(
      <Field label="Name" hint="Shown to other people.">
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).toHaveAccessibleDescription("Shown to other people.");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("swaps the hint for the error, marks the control invalid and announces the error", () => {
    render(
      <Field label="Password" hint="At least 10 characters." error="Use at least 10 characters.">
        <Input type="password" />
      </Field>,
    );
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Use at least 10 characters.");
    expect(screen.getByRole("alert")).toHaveTextContent("Use at least 10 characters.");
    expect(screen.queryByText("At least 10 characters.")).not.toBeInTheDocument();
    const describedBy = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)).toHaveTextContent("Use at least 10 characters.");
  });

  it("keeps a control's own aria-describedby and passes required", () => {
    render(
      <>
        <p id="extra">Extra</p>
        <Field label="Bio" hint="Optional." required>
          <Textarea aria-describedby="extra" />
        </Field>
      </>,
    );
    const textarea = screen.getByRole("textbox", { name: /Bio/ });
    expect(textarea).toHaveAccessibleDescription("Optional. Extra");
    expect(textarea).toBeRequired();
  });

  it("wires a Select trigger to its label and error", () => {
    render(
      <Field label="Role" error="Pick a role.">
        <Select options={[{ value: "admin", label: "Admin" }, { value: "user", label: "User" }]} placeholder="Choose" />
      </Field>,
    );
    const trigger = screen.getByRole("combobox", { name: "Role" });
    expect(trigger).toHaveAccessibleDescription("Pick a role.");
    expect(trigger).toHaveAttribute("aria-invalid", "true");
  });
});

describe("Checkbox and Switch", () => {
  it("toggle by label click", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(
      <>
        <Checkbox label="Admin" description="Can manage users." />
        <Switch label="Only free models" onCheckedChange={onSwitch} />
      </>,
    );
    const box = screen.getByRole("checkbox", { name: "Admin" });
    expect(box).toHaveAccessibleDescription("Can manage users.");
    await user.click(screen.getByText("Admin"));
    expect(box).toBeChecked();
    await user.click(screen.getByText("Only free models"));
    expect(screen.getByRole("switch", { name: "Only free models" })).toBeChecked();
    expect(onSwitch).toHaveBeenCalledWith(true);
  });
});
