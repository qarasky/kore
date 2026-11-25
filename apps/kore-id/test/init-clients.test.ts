import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(env: Record<string, string> = {}) {
  const file = join(mkdtempSync(join(tmpdir(), 'kore-id-clients-')), 'clients.json');
  const out = execFileSync(process.execPath, ['scripts/init-clients.ts'], { env: { ...process.env, ...env, CLIENTS_FILE: file }, encoding: 'utf8' });
  return { out, clients: JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>[] };
}
const byId = (cs: Record<string, any>[], id: string) => cs.find((c) => c.id === id)!;

test('each app gets the callback and logout paths it really serves', () => {
  const { clients } = run({
    KORE_DRIVE_URL: 'https://drive.example', KORECALENDAR_URL: 'https://cal.example',
    KOREMIND_URL: 'https://mind.example', KOREMIND_API_URL: 'https://api.mind.example', KOREMONITOR_URL: 'https://mon.example',
  });
  assert.deepEqual(byId(clients, 'kore').redirectUris, ['https://drive.example/api/auth/oidc/callback']);
  assert.equal(byId(clients, 'kore').backchannelLogoutUri, 'https://drive.example/api/auth/oidc/backchannel-logout');
  assert.deepEqual(byId(clients, 'kore').postLogoutRedirectUris, ['https://drive.example/login']);
  assert.deepEqual(byId(clients, 'korecalendar').redirectUris, ['https://cal.example/api/auth/oidc/callback']);
  assert.equal(byId(clients, 'korecalendar').backchannelLogoutUri, 'https://cal.example/api/auth/oidc/backchannel-logout');
  assert.deepEqual(byId(clients, 'koremind').redirectUris, ['https://api.mind.example/auth/callback']);
  assert.equal(byId(clients, 'koremind').backchannelLogoutUri, 'https://api.mind.example/auth/backchannel-logout');
  assert.deepEqual(byId(clients, 'koremind').postLogoutRedirectUris, ['https://mind.example/login']);
  assert.equal(byId(clients, 'koremind').homeUrl, 'https://mind.example/');
  assert.deepEqual(byId(clients, 'flatline').redirectUris, ['https://mon.example/api/v1/auth/sso/callback']);
  assert.equal(byId(clients, 'flatline').backchannelLogoutUri, 'https://mon.example/api/v1/auth/sso/backchannel-logout');
  assert.deepEqual(byId(clients, 'flatline').postLogoutRedirectUris, ['https://mon.example/sign-in']);
  assert.equal(byId(clients, 'korecalendar-android').app, 'korecalendar');
  for (const c of clients) if (c.homeUrl) assert.match(c.homeUrl, /\/$/);
});

test('a trailing slash in a base URL does not double up', () => {
  const { clients } = run({ KORE_DRIVE_URL: 'https://drive.example/' });
  assert.deepEqual(byId(clients, 'kore').redirectUris, ['https://drive.example/api/auth/oidc/callback']);
});
