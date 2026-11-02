/** The app mark: a 3×3 grid of tiles in the accent colour, today's tile solid
 *  and its row and column fading out (same ramp as the app icon). */
export function Logo({ className = "size-[1.1em]" }: { className?: string }) {
  const o = [0.3, 0.6, 0.3, 0.6, 1, 0.6, 0.3, 0.6, 0.3];
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={className}>
      {o.map((opacity, i) => (
        <rect key={i} x={(i % 3) * 6} y={Math.floor(i / 3) * 6} width="4" height="4" rx="1" className="fill-accent" opacity={opacity} />
      ))}
    </svg>
  );
}
