// Single source of truth for the Zero mark: a ring of four arcs on Kore's 1 / 0.6 / 0.3 / 0.6 opacity ramp.
const ACCENT = "#5b8def";
const ARCS: { d: string; opacity: number; alpha: string }[] = [
  { d: "M35.62 18.48A14 14 0 0 1 45.52 28.38", opacity: 1, alpha: "ff" },
  { d: "M45.52 35.62A14 14 0 0 1 35.62 45.52", opacity: 0.6, alpha: "99" },
  { d: "M28.38 45.52A14 14 0 0 1 18.48 35.62", opacity: 0.3, alpha: "4d" },
  { d: "M18.48 28.38A14 14 0 0 1 28.38 18.48", opacity: 0.6, alpha: "99" },
];

export function markSvg(): string {
  const paths = ARCS.map((a) => `    <path d="${a.d}"${a.opacity < 1 ? ` opacity="${a.opacity}"` : ""}/>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect x="1" y="1" width="62" height="62" rx="14" fill="#16181d" stroke="#2c3038"/>
  <g fill="none" stroke="${ACCENT}" stroke-width="6" stroke-linecap="round">
${paths}
  </g>
</svg>
`;
}

/** Android adaptive-icon foreground (the background layer is the solid #16181d color resource). */
export function androidForeground(): string {
  const toAndroid = (d: string) => d.replace(/A(\d+) (\d+) 0 0 1 /, "A$1,$2 0 0,1 ").replace(/M([\d.]+) ([\d.]+)/, "M$1,$2");
  const paths = ARCS.map((a) => {
    const color = a.alpha === "ff" ? ACCENT : `#${a.alpha}${ACCENT.slice(1)}`;
    return `        <path android:pathData="${toAndroid(a.d)}" android:strokeColor="${color}" android:strokeWidth="6" android:strokeLineCap="round" android:fillColor="#00000000" />`;
  }).join("\n");
  return `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <group android:scaleX="1.0" android:scaleY="1.0" android:translateX="22" android:translateY="22">
${paths}
    </group>
</vector>
`;
}
