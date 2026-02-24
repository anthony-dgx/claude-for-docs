#!/usr/bin/env tsx
/**
 * Re-authorizes the OAuth token with Gmail + Drive scopes.
 *
 * Usage: npx tsx scripts/add-gmail-scope.ts
 *
 * Reads OAuth client credentials from ~/.docpat.json:
 *   { "oauth": { "clientId": "...", "clientSecret": "..." } }
 *
 * Opens a browser for Google login. After consent, saves the token
 * to ~/.config/rclone/rclone.conf so it works with both Drive and Gmail.
 */

import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { exec } from 'child_process';

const RCLONE_CONFIG = join(homedir(), '.config/rclone/rclone.conf');
const DOCPAT_CONFIG = join(homedir(), '.docpat.json');
const REMOTE = 'gdrive';
const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/`;

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.modify',
].join(' ');

// Load OAuth credentials from ~/.docpat.json
function loadCredentials(): { clientId: string; clientSecret: string } {
  if (!existsSync(DOCPAT_CONFIG)) {
    console.error('Missing ~/.docpat.json');
    console.error('Create it with your OAuth credentials:');
    console.error(JSON.stringify({
      oauth: { clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com', clientSecret: 'YOUR_SECRET' }
    }, null, 2));
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(DOCPAT_CONFIG, 'utf-8'));
  if (!config.oauth?.clientId || !config.oauth?.clientSecret) {
    console.error('Missing oauth.clientId or oauth.clientSecret in ~/.docpat.json');
    console.error('Add your Google Cloud OAuth credentials:');
    console.error('  "oauth": { "clientId": "...", "clientSecret": "..." }');
    process.exit(1);
  }
  return { clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret };
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' :
              process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

function updateRcloneToken(tokenJson: string) {
  let config = readFileSync(RCLONE_CONFIG, 'utf-8');
  const lines = config.split('\n');
  let inSection = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `[${REMOTE}]`) {
      inSection = true;
      continue;
    }
    if (lines[i].trim().startsWith('[') && inSection) break;
    if (inSection && lines[i].trim().startsWith('token =')) {
      lines[i] = `token = ${tokenJson}`;
      writeFileSync(RCLONE_CONFIG, lines.join('\n'));
      return;
    }
  }
  throw new Error(`Could not find token line in [${REMOTE}] section of ${RCLONE_CONFIG}`);
}

async function exchangeCode(code: string, clientId: string, clientSecret: string): Promise<any> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${body}`);
  }
  return resp.json();
}

const { clientId, clientSecret } = loadCredentials();

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://127.0.0.1:${REDIRECT_PORT}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h2>Authorization failed</h2><p>${error}</p><p>You can close this tab.</p>`);
    console.error(`\nAuthorization failed: ${error}`);
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400);
    res.end('Missing code');
    return;
  }

  try {
    console.log('\nExchanging authorization code for token...');
    const data = await exchangeCode(code, clientId, clientSecret);

    const token = {
      access_token: data.access_token,
      token_type: data.token_type || 'Bearer',
      refresh_token: data.refresh_token,
      expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };

    updateRcloneToken(JSON.stringify(token));

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Success!</h2><p>Gmail + Drive access granted. You can close this tab and restart the DocPat server.</p>');

    console.log('\nToken updated in', RCLONE_CONFIG);
    console.log('Gmail scope granted. Restart the DocPat server to use Gmail tools.');
    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h2>Error</h2><p>${err}</p>`);
    console.error('\nError:', err);
    process.exit(1);
  }
});

server.listen(REDIRECT_PORT, '127.0.0.1', () => {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  console.log('Opening browser for Google authorization...');
  console.log('Grant access to both Google Drive AND Gmail.\n');
  console.log('If the browser doesn\'t open, visit:');
  console.log(authUrl.toString());

  openBrowser(authUrl.toString());
});
