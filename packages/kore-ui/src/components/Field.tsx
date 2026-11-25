"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "../lib/cn";

type FieldContextValue = {
  id: string;
  labelId: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/** The surrounding Field's wiring, or null outside a Field. */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
  "aria-labelledby"?: string;
  required?: boolean;
  disabled?: boolean;
};

/**
 * Merges a control's own props with its Field: id (for the label), aria-describedby
 * (hint + error), aria-invalid, required, disabled. Controls call this; apps don't need to.
 */
export function useFieldControl<P extends ControlProps>(props: P): P {
  const field = useField();
  if (!field) return props;
  const describedBy = [field.describedBy, props["aria-describedby"]].filter(Boolean).join(" ") || undefined;
  return {
    ...props,
    id: props.id ?? field.id,
    "aria-describedby": describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid || undefined),
    required: props.required ?? (field.required || undefined),
    disabled: props.disabled ?? (field.disabled || undefined),
  };
}

export type FieldProps = {
  /** Visible label, sentence case, no colon. */
  label: ReactNode;
  /** Help under the control. Hidden while there is an error. */
  hint?: ReactNode;
  /** What is wrong and how to fix it. Turns the control red and is announced. */
  error?: ReactNode;
  /** Id of the control (default: generated). */
  id?: string;
  required?: boolean;
  disabled?: boolean;
  /** Trailing content on the label row, e.g. a "Forgot?" link or a counter. */
  labelAside?: ReactNode;
  className?: string;
  /** One control: Input, Textarea, Select, RadioGroup… */
  children: ReactNode;
};

/**
 * Label, control, hint and error, wired for assistive tech: the label points at the control,
 * and the control's `aria-describedby` lists the hint/error. The control picks this up itself.
 */
export function Field({ label, hint, error, id, required = false, disabled = false, labelAside, className, children }: FieldProps) {
  const generated = useId();
  const controlId = id ?? `${generated}-control`;
  const labelId = `${controlId}-label`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const hasError = error != null && error !== false && error !== "";
  const showHint = hint != null && !hasError;
  const describedBy = [showHint && hintId, hasError && errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext value={{ id: controlId, labelId, describedBy, invalid: hasError, required, disabled }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <div className="flex items-baseline justify-between gap-3">
          <label id={labelId} htmlFor={controlId} className="text-meta font-medium text-muted">
            {label}
            {required ? (
              <span aria-hidden="true" className="ml-0.5 text-muted">
                *
              </span>
            ) : null}
          </label>
          {labelAside ? <div className="text-meta text-muted">{labelAside}</div> : null}
        </div>
        {children}
        {showHint ? (
          <p id={hintId} className="text-meta text-muted">
            {hint}
          </p>
        ) : null}
        {hasError ? (
          <p id={errorId} role="alert" className="text-meta text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext>
  );
}
