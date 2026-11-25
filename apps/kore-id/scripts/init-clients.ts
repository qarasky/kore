// Writes clients.json with one confidential client per Kore app, using the callback and logout
// paths each app really serves, and prints the secrets once.
//
//   KORE_DRIVE_URL=https://drive.example.com KORECALENDAR_URL=https://calendar.example.com \
//   KOREMIND_URL=https://koremind.example.com KOREMIND_API_URL=https://api.koremind.example.com \
//   KOREMONITOR_URL=https://monitor.example.com node scripts/init-clients.ts
//
// Each *_URL is the app's public address (the defaults are the apps' local defaults). KoreMind's
// backend does the sign-in, so its callback lives on KOREMIND_API_URL; its web UI is KOREMIND_URL.
import { writeFileSync, existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';

const file = process.env.CLIENTS_FILE ?? 'clients.json';
if (existsSync(file) && !process.argv.includes('--force')) {
  console.error(`${file} already exists (use --force to overwrite; secrets will change).`);
  process.exit(1);
}

const base = (name: string, fallback: string) => (process.env[name] || fallback).replace(/\/+$/, '');
const drive = base('KORE_DRIVE_URL', 'http://localhost:8080');
const calendar = base('KORECALENDAR_URL', 'http://localhost:8081');
const mind = base('KOREMIND_URL', 'http://localhost:3210');
const mindApi = base('KOREMIND_API_URL', 'http://localhost:8787');
const monitor = base('KOREMONITOR_URL', 'http://localhost:3001');

// id = the client id and app key each app expects by default. KoreMonitor still uses "flatline".
const apps = [
  { id: 'kore', name: 'Kore Drive', callback: `${drive}/api/auth/oidc/callback`, backchannel: `${drive}/api/auth/oidc/backchannel-logout`, afterLogout: `${drive}/login`, home: `${drive}/` },
  { id: 'korecalendar', name: 'KoreCalendar', callback: `${calendar}/api/auth/oidc/callback`, backchannel: `${calendar}/api/auth/oidc/backchannel-logout`, afterLogout: `${calendar}/login`, home: `${calendar}/` },
  { id: 'koremind', name: 'KoreMind', callback: `${mindApi}/auth/callback`, backchannel: `${mindApi}/auth/backchannel-logout`, afterLogout: `${mind}/login`, home: `${mind}/` },
  { id: 'flatline', name: 'KoreMonitor', callback: `${monitor}/api/v1/auth/sso/callback`, backchannel: `${monitor}/api/v1/auth/sso/backchannel-logout`, afterLogout: `${monitor}/sign-in`, home: `${monitor}/` },
];

const secrets: Record<string, string> = {};
const clients: Record<string, unknown>[] = apps.map((a) => {
  const secret = randomBytes(32).toString('base64url');
  secrets[a.id] = secret;
  return {
    id: a.id,
    name: a.name,
    app: a.id,
    secretHash: createHash('sha256').update(secret).digest('hex'),
    redirectUris: [a.callback],
    postLogoutRedirectUris: [a.afterLogout],
    backchannelLogoutUri: a.backchannel,
    homeUrl: a.home,
  };
});
// KoreCalendar's Android app talks to Kore ID itself: a public client (PKCE only, no secret) that
// shares KoreCalendar's app access. Set KORECAL_OIDC_EXTRA_AUDIENCES=korecalendar-android on the API.
// KoreMind's Android app signs in through its backend and needs no client of its own.
clients.push({
  id: 'korecalendar-android',
  name: 'KoreCalendar (Android)',
  app: 'korecalendar',
  redirectUris: ['dev.qarasky.korecalendar:/oauth2redirect'],
  postLogoutRedirectUris: [],
});
writeFileSync(file, JSON.stringify(clients, null, 2), { mode: 0o600 });
console.log(`Wrote ${file}. Client secrets (shown ONCE, store them in each app's env):\n`);
for (const [id, s] of Object.entries(secrets)) console.log(`  ${id}: ${s}`);
console.log('\n  korecalendar-android: public client, no secret');
