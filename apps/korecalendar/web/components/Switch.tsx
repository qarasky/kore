"use client";

/** An on/off switch (`role="switch"`) with its label to the right. */
export function Switch({
  checked,
  onChange,
  label,
  id,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-control items-center gap-2.5 rounded-ui text-sub disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-border-strong"}`}
      >
        <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] ${checked ? "left-[1.1rem]" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}
