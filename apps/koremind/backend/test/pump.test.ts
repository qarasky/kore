import { expect, test } from "bun:test";
import { CLOSED, IDLE, Pump } from "../src/engine/pump";

test("pump returns queued values in order", async () => {
  const p = new Pump<number>(50);
  p.push(1); p.push(2);
  expect([await p.next(), await p.next()]).toEqual([1, 2]);
});

test("pump wakes immediately on push", async () => {
  const p = new Pump<string>(500);
  const t0 = performance.now();
  const pending = p.next();
  setTimeout(() => p.push("x"), 10);
  expect(await pending).toBe("x");
  expect(performance.now() - t0).toBeLessThan(200);
});

test("pump resolves IDLE when nothing happens within idleMs", async () => {
  expect(await new Pump<number>(30).next()).toBe(IDLE);
});

test("pump touch keeps a quiet-but-alive stream waiting", async () => {
  const p = new Pump<string>(40);
  const pending = p.next();
  setTimeout(() => p.touch(), 25);
  setTimeout(() => p.touch(), 50);
  setTimeout(() => p.push("late"), 75);
  expect(await pending).toBe("late");
});

test("pump close wakes a waiter with CLOSED", async () => {
  const p = new Pump<number>(500);
  const pending = p.next();
  p.close();
  expect(await pending).toBe(CLOSED);
});
