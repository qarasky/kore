/** Zero mark: a ring of four arcs with Kore's 1 / 0.6 / 0.3 / 0.6 opacity ramp. Inline SVG, nothing is downloaded. */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="14 14 36 36" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" className="text-accent">
      <path d="M35.62 18.48A14 14 0 0 1 45.52 28.38" />
      <path d="M45.52 35.62A14 14 0 0 1 35.62 45.52" opacity="0.6" />
      <path d="M28.38 45.52A14 14 0 0 1 18.48 35.62" opacity="0.3" />
      <path d="M18.48 28.38A14 14 0 0 1 28.38 18.48" opacity="0.6" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-brand font-semibold tracking-[-0.03em]">
      <Mark size={20} />
      Zero
    </span>
  );
}
