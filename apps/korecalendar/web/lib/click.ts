/** Where a click on an empty part of a day column starts a new event: the
 *  position in the column (`y` of `height` pixels = the whole 24 h) snapped
 *  down to the half hour. */
export function snapForClick(y: number, height: number, stepMinutes = 30): number {
  const minutes = (Math.max(0, Math.min(y, height - 1)) / height) * 1440;
  return Math.floor(minutes / stepMinutes) * stepMinutes;
}
