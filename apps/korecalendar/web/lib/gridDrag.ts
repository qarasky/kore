/**
 * The pointer and keyboard state machine behind dragging on the time grid,
 * kept apart from React: a press that travels 4px becomes a drag (create on
 * empty space, move on an event, resize on its bottom edge); Escape cancels;
 * dropping reports whole days and snapped minutes. The host supplies the
 * geometry and receives the results.
 */
import { applyDelta, exceedsThreshold, moveDelta, pointToSlot, rangeFromDrag, resizeDuration, STEP, type Point, type Slot } from "./drag";
import type { Placed } from "./layout";

export type Ghost =
  | { kind: "create"; dayIndex: number; startMin: number; endMin: number }
  | { kind: "move" | "resize"; id: string; dayIndex: number; top: number; height: number };

export const placedId = (p: Placed) => `${p.occ.event_id}|${p.occ.key}|${p.day}`;

export type Area = { left: number; top: number; width: number; height: number };

export type Host = {
  area: () => Area | null;
  days: () => string[];
  setGhost: (g: Ghost | null) => void;
  /** A drop was handed to a callback: the ghost should stay until the caller says it has settled. */
  setDropped: (dropped: boolean) => void;
  onCreate: (range: { day: string; startMinutes: number; endMinutes: number }) => void;
  onMove: (placed: Placed, move: { deltaDays: number; deltaMinutes: number }) => void;
  onResize: (placed: Placed, durationMinutes: number) => void;
};

type Kind = "create" | "move" | "resize";
type Session = { kind: Kind; origin: Point; startSlot: Slot; placed?: Placed; active: boolean };
type KeySession = { placed: Placed; deltaDays: number; deltaMinutes: number; duration: number | null; timer: number };

export const KEY_COMMIT_MS = 600;

export class GridDragController {
  host: Host;
  private session: Session | null = null;
  private keys: KeySession | null = null;
  /** True for one tick after a drag ends, so the click the browser then fires is ignored. */
  private suppressClick = false;

  constructor(host: Host) {
    this.host = host;
  }

  setHost(host: Host) {
    this.host = host;
  }

  private slotAt(p: Point): Slot {
    const area = this.host.area();
    if (!area) return { dayIndex: 0, minutes: 0 };
    return pointToSlot(p, area, this.host.days().length);
  }

  /** Starts a press. Touch is left to scrolling (tap opens things instead). */
  begin(kind: Kind, e: { button: number; pointerType: string; clientX: number; clientY: number }, placed?: Placed) {
    if (e.button !== 0 || e.pointerType === "touch") return;
    const origin = { x: e.clientX, y: e.clientY };
    this.session = { kind, origin, startSlot: this.slotAt(origin), placed, active: false };
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.cancel);
    window.addEventListener("keydown", this.onEscape, true);
  }

  private release() {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.cancel);
    window.removeEventListener("keydown", this.onEscape, true);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    this.session = null;
  }

  cancel = () => {
    const wasDragging = this.session?.active ?? false;
    this.release();
    this.host.setGhost(null);
    if (wasDragging) this.swallowNextClick();
  };

  /** The release that ends a cancelled drag still fires a click: ignore that one. */
  private swallowNextClick() {
    this.suppressClick = true;
    window.addEventListener(
      "pointerup",
      () =>
        setTimeout(() => {
          this.suppressClick = false;
        }, 0),
      { once: true },
    );
  }

  private onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.session) {
      e.stopPropagation();
      this.cancel();
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const s = this.session;
    if (!s) return;
    const here = { x: e.clientX, y: e.clientY };
    if (!s.active) {
      if (!exceedsThreshold(s.origin, here)) return;
      s.active = true;
      document.body.style.userSelect = "none";
      document.body.style.cursor = s.kind === "resize" ? "ns-resize" : s.kind === "move" ? "grabbing" : "crosshair";
    }
    this.host.setGhost(this.ghostFor(s, this.slotAt(here)));
  };

  private ghostFor(s: Session, slot: Slot): Ghost | null {
    const days = this.host.days();
    if (s.kind === "create") {
      const r = rangeFromDrag(s.startSlot, slot);
      return { kind: "create", dayIndex: r.dayIndex, startMin: r.startMinutes, endMin: r.endMinutes };
    }
    if (!s.placed) return null;
    const base = { dayIndex: days.indexOf(s.placed.day), top: s.placed.top, height: s.placed.height };
    if (s.kind === "move") {
      const d = moveDelta(s.startSlot, slot);
      return { kind: "move", id: placedId(s.placed), ...applyDelta(base, d.deltaDays, d.deltaMinutes, days.length) };
    }
    return { kind: "resize", id: placedId(s.placed), ...base, height: this.resized(s, slot) };
  }

  /** The new length: the end edge follows the pointer's movement (grabbing the handle anywhere does not make it jump). */
  private resized(s: Session, slot: Slot): number {
    const placed = s.placed!;
    return resizeDuration(placed.top, placed.top + placed.height + (slot.minutes - s.startSlot.minutes));
  }

  private onPointerUp = (e: PointerEvent) => {
    const s = this.session;
    this.release();
    if (!s || !s.active) return; // a click: the element's own handler takes it
    this.suppressClick = true;
    setTimeout(() => {
      this.suppressClick = false;
    }, 0);
    const slot = this.slotAt({ x: e.clientX, y: e.clientY });
    const days = this.host.days();
    if (s.kind === "create") {
      const r = rangeFromDrag(s.startSlot, slot);
      this.host.setGhost(null);
      this.host.onCreate({ day: days[r.dayIndex], startMinutes: r.startMinutes, endMinutes: r.endMinutes });
      return;
    }
    if (!s.placed) return;
    if (s.kind === "move") {
      const delta = moveDelta(s.startSlot, slot);
      if (delta.deltaDays === 0 && delta.deltaMinutes === 0) {
        this.host.setGhost(null);
        return;
      }
      this.host.setDropped(true);
      this.host.onMove(s.placed, delta);
      return;
    }
    const duration = this.resized(s, slot);
    if (duration === s.placed.height) {
      this.host.setGhost(null);
      return;
    }
    this.host.setDropped(true);
    this.host.onResize(s.placed, duration);
  };

  // --- keyboard: Alt+arrows move, Shift+Up/Down resize; applied after a short pause or on Enter

  private commitKeys() {
    const k = this.keys;
    if (!k) return;
    window.clearTimeout(k.timer);
    this.keys = null;
    this.host.setDropped(true);
    if (k.duration !== null) this.host.onResize(k.placed, k.duration);
    else this.host.onMove(k.placed, { deltaDays: k.deltaDays, deltaMinutes: k.deltaMinutes });
  }

  /** Handles a key press on a focused event block; returns true when it was a drag key. */
  key(e: { key: string; altKey: boolean; shiftKey: boolean; preventDefault: () => void; stopPropagation: () => void }, placed: Placed): boolean {
    const pending = this.keys;
    if (e.key === "Escape" && pending) {
      window.clearTimeout(pending.timer);
      this.keys = null;
      this.host.setGhost(null);
      return true;
    }
    if (e.key === "Enter" && pending) {
      e.preventDefault();
      e.stopPropagation();
      this.commitKeys();
      return true;
    }
    const vertical = e.key === "ArrowUp" || e.key === "ArrowDown";
    const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
    const move = e.altKey && !e.shiftKey && (vertical || horizontal);
    const resize = e.shiftKey && !e.altKey && vertical && !placed.continuesBefore && !placed.continuesAfter;
    if (!move && !resize) return false;
    e.preventDefault();
    e.stopPropagation();
    const same = pending && placedId(pending.placed) === placedId(placed);
    const cur: KeySession = same ? pending : { placed, deltaDays: 0, deltaMinutes: 0, duration: null, timer: 0 };
    window.clearTimeout(cur.timer);
    const sign = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1;
    if (resize) cur.duration = Math.max(STEP, (cur.duration ?? placed.height) + sign * STEP);
    else if (vertical) cur.deltaMinutes += sign * STEP;
    else cur.deltaDays += sign;
    cur.timer = window.setTimeout(() => this.commitKeys(), KEY_COMMIT_MS);
    this.keys = cur;
    const days = this.host.days();
    const base = { dayIndex: days.indexOf(placed.day), top: placed.top, height: placed.height };
    this.host.setGhost(
      cur.duration !== null
        ? { kind: "resize", id: placedId(placed), ...base, height: cur.duration }
        : { kind: "move", id: placedId(placed), ...applyDelta(base, cur.deltaDays, cur.deltaMinutes, days.length) },
    );
    return true;
  }

  /** True once, if a click is the tail of a drag and should be ignored. */
  consumeClick(): boolean {
    const was = this.suppressClick;
    this.suppressClick = false;
    return was;
  }

  dispose() {
    if (this.keys) window.clearTimeout(this.keys.timer);
    this.keys = null;
    this.release();
  }
}
