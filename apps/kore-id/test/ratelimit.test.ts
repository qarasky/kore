import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers.ts';
import { RateLimiter } from '../src/app.ts';

const wrong = { password: 'definitely wrong pw' };

async function attempt(e: ReturnType<typeof makeEnv>, email: string, headers: Record<string, string> = {}) {
  const b = new e.Browser();
  await b.req('/api/session');
  const res = await b.req('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': b.csrf!, ...headers },
    body: JSON.stringify({ email, ...wrong }),
  });
  return res.status;
}

test('parallel wrong logins cannot exceed the limit', async () => {
  const e = makeEnv();
  await e.user('ada@example.com');
  const statuses = await Promise.all(Array.from({ length: 25 }, () => attempt(e, 'ada@example.com')));
  assert.ok(statuses.filter((s) => s === 401).length <= 10, `401s: ${statuses.filter((s) => s === 401).length}`);
  assert.ok(statuses.includes(429));
});

test('a spoofed leftmost X-Forwarded-For does not reset the limit', async () => {
  const e = makeEnv({ trustProxy: true });
  await e.user('ada@example.com');
  const statuses: number[] = [];
  for (let i = 0; i < 15; i++) statuses.push(await attempt(e, 'ada@example.com', { 'x-forwarded-for': `10.0.${i}.1, 203.0.113.5` }));
  assert.equal(statuses.at(-1), 429);
});

test('guessing across many emails from one address is capped', async () => {
  const e = makeEnv({ trustProxy: true });
  const statuses: number[] = [];
  for (let i = 0; i < 120; i++) statuses.push(await attempt(e, `user${i}@example.com`, { 'x-forwarded-for': '203.0.113.9' }));
  assert.equal(statuses.at(-1), 429);
});

test('a successful login does not use up the allowance', async () => {
  const e = makeEnv();
  await e.user('ada@example.com');
  for (let i = 0; i < 12; i++) assert.equal((await e.login('ada@example.com')).r.status, 200);
});

test('filling the limiter with new keys does not unblock a blocked key', () => {
  const l = new RateLimiter(3, 900, 100);
  for (let i = 0; i < 3; i++) l.hit('victim');
  assert.equal(l.blocked('victim'), true);
  for (let i = 0; i < 500; i++) l.hit(`noise-${i}`);
  assert.equal(l.blocked('victim'), true);
});
