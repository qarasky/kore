/**
 * The built-in login screen artwork: soft layered gradients in the brand's
 * navy and accent blue with a faint grid of the Kore four-tile mark. Inline
 * SVG (nothing is downloaded); `slice` fills any aspect ratio like
 * `object-fit: cover`.
 */
export function LoginArt({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-testid="login-art"
      viewBox="0 0 1600 1200"
      preserveAspectRatio="xMidYMid slice"
      className={className}
    >
      <defs>
        <linearGradient id="kore-art-base" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#141a2b" />
          <stop offset="0.55" stopColor="#111522" />
          <stop offset="1" stopColor="#0d1018" />
        </linearGradient>
        <radialGradient id="kore-art-glow-a" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#5b8def" stopOpacity="0.55" />
          <stop offset="1" stopColor="#5b8def" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="kore-art-glow-b" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#7b6cf0" stopOpacity="0.35" />
          <stop offset="1" stopColor="#7b6cf0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="kore-art-glow-c" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#3fb6c9" stopOpacity="0.22" />
          <stop offset="1" stopColor="#3fb6c9" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="kore-art-fade" cx="0.5" cy="0.5" r="0.62">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.7" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <pattern id="kore-art-marks" width="64" height="64" patternUnits="userSpaceOnUse">
          <rect x="24" y="24" width="7" height="7" rx="1.5" fill="#8fb0f5" />
          <rect x="33" y="24" width="7" height="7" rx="1.5" fill="#8fb0f5" fillOpacity="0.6" />
          <rect x="24" y="33" width="7" height="7" rx="1.5" fill="#8fb0f5" fillOpacity="0.6" />
          <rect x="33" y="33" width="7" height="7" rx="1.5" fill="#8fb0f5" fillOpacity="0.3" />
        </pattern>
        <mask id="kore-art-mask">
          <rect width="1600" height="1200" fill="url(#kore-art-fade)" />
        </mask>
      </defs>

      <rect width="1600" height="1200" fill="url(#kore-art-base)" />
      <ellipse cx="900" cy="520" rx="720" ry="560" fill="url(#kore-art-glow-a)" />
      <ellipse cx="420" cy="980" rx="760" ry="520" fill="url(#kore-art-glow-b)" />
      <ellipse cx="1420" cy="1060" rx="520" ry="420" fill="url(#kore-art-glow-c)" />
      <ellipse cx="260" cy="160" rx="480" ry="360" fill="url(#kore-art-glow-c)" />

      <rect width="1600" height="1200" fill="url(#kore-art-marks)" opacity="0.09" mask="url(#kore-art-mask)" />

      {/* One larger mark in the centre (kept visible at any crop). */}
      <g transform="translate(706 506)" opacity="0.8">
        <rect x="0" y="0" width="84" height="84" rx="18" fill="#5b8def" />
        <rect x="104" y="0" width="84" height="84" rx="18" fill="#5b8def" fillOpacity="0.6" />
        <rect x="0" y="104" width="84" height="84" rx="18" fill="#5b8def" fillOpacity="0.6" />
        <rect x="104" y="104" width="84" height="84" rx="18" fill="#5b8def" fillOpacity="0.3" />
      </g>
    </svg>
  );
}
