"use client";
import { providerIconKey, type ProviderIconKey } from "@/lib/model-picker";

/** The providers' real marks, from assets/providers (models.dev). They draw in the current text colour. */
type Shape = { d: string; opacity?: number; transform?: string };
const ICONS: Record<ProviderIconKey, { viewBox: string; shapes: Shape[] }> = {
  opencode: { viewBox: "0 0 24 24", shapes: [{ d: "M15.6 17.4H8.4V10.2H15.6V17.4Z", opacity: 0.4 }, { d: "M15.6 6.6H8.4V17.4H15.6V6.6ZM19.2 21H4.8V3H19.2V21Z" }] },
};

export function ProviderIcon({ id, name, size = 20 }: { id: string; name: string; size?: number }) {
  const key = providerIconKey(id);
  const icon = key ? ICONS[key] : null;
  if (!icon) return <span className="grid place-items-center rounded-full bg-track text-2xs font-semibold uppercase" style={{ width: size, height: size }} aria-hidden>{name.slice(0, 1)}</span>;
  return (
    <svg viewBox={icon.viewBox} width={size} height={size} fill="currentColor" aria-hidden focusable="false">
      {icon.shapes.map((sh, i) => <path key={i} d={sh.d} fillOpacity={sh.opacity} transform={sh.transform} />)}
    </svg>
  );
}
