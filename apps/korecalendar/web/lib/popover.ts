/** Where an anchored popover goes. Pure, so it can be tested without a DOM. */

export type Box = { left: number; top: number; width: number; height: number };

/**
 * Places a popover of `size` next to `anchor` inside `viewport`: to the right
 * if it fits, else to the left, else centred over the anchor; vertically
 * aligned with the anchor's top, shifted up when it would run off the bottom,
 * and never closer than `margin` to any edge.
 */
export function placePopover(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
  margin = 8,
): { left: number; top: number; side: "right" | "left" | "center" } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  const rightX = anchor.left + anchor.width + gap;
  const leftX = anchor.left - gap - size.width;
  let left: number;
  let side: "right" | "left" | "center";
  if (rightX + size.width <= viewport.width - margin) {
    left = rightX;
    side = "right";
  } else if (leftX >= margin) {
    left = leftX;
    side = "left";
  } else {
    left = anchor.left + anchor.width / 2 - size.width / 2;
    side = "center";
  }
  left = clamp(left, margin, Math.max(margin, viewport.width - size.width - margin));
  const top = clamp(anchor.top, margin, Math.max(margin, viewport.height - size.height - margin));
  return { left, top, side };
}
