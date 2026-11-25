import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, purgeExpired } from '../src/db.ts';
import { makeEnv, ISS } from './helpers.ts';

const DAY = 86400;

function audit(db: ReturnType<typeof openDb>, action: string, ageDays: number, now: number) {
  db.prepare('INSERT INTO audit_log (created_at, action) VALUES (?, ?)').run(now - ageDays * DAY, action);
}
const count = (db: ReturnType<typeof openDb>, where = '1=1') =>
  (db.prepare(`SELECT count(*) AS n FROM audit_log WHERE ${where}`).get() as { n: number }).n;

test('old audit rows are purged; failed logins sooner', () => {
  const db = openDb(':memory:');
  const now = 2_000_000_000;
  audit(db, 'login', 200, now);
  audit(db, 'login', 100, now);
  audit(db, 'login_failed', 40, now);
  audit(db, 'login_failed', 10, now);
  purgeExpired(db, now);
  assert.equal(count(db, "action = 'login'"), 1);
  assert.equal(count(db, "action = 'login_failed'"), 1);
});

test('the audit log is capped, oldest rows first', () => {
  const db = openDb(':memory:');
  const now = 2_000_000_000;
  for (let i = 0; i < 50; i++) audit(db, 'login', 50 - i, now);
  purgeExpired(db, now, { maxAuditRows: 20 });
  assert.equal(count(db), 20);
  assert.equal(count(db, `created_at < ${now - 20 * DAY}`), 0);
});

test('an oversized request body is refused', async () => {
  const e = makeEnv();
  const res = await e.app.request(ISS + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x'.repeat(200_000) }),
  });
  assert.equal(res.status, 413);
});
