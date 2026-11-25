import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, tokensFor, basic } from './helpers.ts';

test('removing an app signs the user out of that app only', async () => {
  const e = makeEnv();
  const { id, b } = await e.user('ada@example.com');
  const kore = await tokensFor(b, 'kore');
  const mind = await tokensFor(b, 'koremind');

  const r = await (await e.admin()).api('PATCH', `/admin/users/${id}`, { apps: ['koremind', 'korecalendar', 'flatline'] });
  assert.equal(r.status, 200);
  await e.app.idle();

  assert.deepEqual(e.sent.map((s) => s.url), ['http://kore.test/backchannel-logout']);
  assert.equal((await b.post('/token', { grant_type: 'refresh_token', refresh_token: kore.refresh_token! }, basic('kore'))).status, 400);
  assert.equal((await b.post('/token', { grant_type: 'refresh_token', refresh_token: mind.refresh_token! }, basic('koremind'))).status, 200);
  assert.notEqual((await b.api('GET', '/session')).body.user, null, 'the Kore ID session itself stays');
});

test('demoting an admin signs them out of apps they no longer have', async () => {
  const e = makeEnv();
  const { id, b } = await e.user('boss@example.com', [], 'admin');
  const kore = await tokensFor(b, 'kore');

  const r = await (await e.admin()).api('PATCH', `/admin/users/${id}`, { role: 'user' });
  assert.equal(r.status, 200);
  await e.app.idle();

  assert.deepEqual(e.sent.map((s) => s.url), ['http://kore.test/backchannel-logout']);
  assert.equal((await b.post('/token', { grant_type: 'refresh_token', refresh_token: kore.refresh_token! }, basic('kore'))).status, 400);
});

test('an unchanged app list notifies nobody', async () => {
  const e = makeEnv();
  const { id, b } = await e.user('ada@example.com');
  await tokensFor(b, 'kore');
  await (await e.admin()).api('PATCH', `/admin/users/${id}`, { name: 'Ada L.' });
  await e.app.idle();
  assert.deepEqual(e.sent, []);
});
