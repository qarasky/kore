/** A queue a consumer can wait on, with an idle watchdog: any activity (a value, or a touch) resets the timer. */
export const IDLE = Symbol("idle");
export const CLOSED = Symbol("closed");

export class Pump<T> {
  private queue: T[] = [];
  private wake: ((v: T | typeof IDLE | typeof CLOSED) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private idleMs: number) {}

  push(v: T) {
    if (this.wake) this.resolve(v);
    else this.queue.push(v);
  }

  /** Shows the stream is alive without producing a value. */
  touch() {
    if (!this.wake) return;
    this.arm();
  }

  close() {
    this.closed = true;
    if (this.wake) this.resolve(CLOSED);
  }

  next(): Promise<T | typeof IDLE | typeof CLOSED> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.closed) return Promise.resolve(CLOSED);
    return new Promise((res) => {
      this.wake = res;
      this.arm();
    });
  }

  private arm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (this.wake) this.resolve(IDLE); }, this.idleMs);
  }

  private resolve(v: T | typeof IDLE | typeof CLOSED) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const w = this.wake!;
    this.wake = null;
    w(v);
  }
}
