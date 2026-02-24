import { readFileSync, writeFileSync } from 'fs';
import { CONFIG } from '../config.js';

// Rclone's built-in OAuth client credentials (public, hardcoded in rclone source)
const RCLONE_CLIENT_ID = '202264815644.apps.googleusercontent.com';
const RCLONE_CLIENT_SECRET = 'X4Z3ca8xfWDb1Voo-F9a7ZxJ';

// Custom OAuth client from ~/.docpat.json (needed for Gmail scope)
function loadCustomOAuth(): { clientId: string; clientSecret: string } | null {
  try {
    const { readFileSync, existsSync } = require('fs');
    const { join } = require('path');
    const { homedir } = require('os');
    const configPath = join(homedir(), '.docpat.json');
    if (!existsSync(configPath)) return null;
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config.oauth?.clientId && config.oauth?.clientSecret) {
      return { clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret };
    }
  } catch {}
  return null;
}

const customOAuth = loadCustomOAuth();
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

interface GoogleToken {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expiry: string;
  expires_in?: number;
}

export class TokenManager {
  private token: GoogleToken;
  private configPath: string;
  private remote: string;

  constructor(configPath = CONFIG.rcloneConfigPath, remote = CONFIG.rcloneRemote) {
    this.configPath = configPath;
    this.remote = remote;
    this.token = this.readTokenFromConfig();
  }

  async getAccessToken(): Promise<string> {
    if (this.isExpired()) {
      await this.refresh();
    }
    return this.token.access_token;
  }

  getScope(): string {
    const config = readFileSync(this.configPath, 'utf-8');
    const section = this.parseSection(config, this.remote);
    return section.scope || 'unknown';
  }

  private readTokenFromConfig(): GoogleToken {
    const config = readFileSync(this.configPath, 'utf-8');
    const section = this.parseSection(config, this.remote);
    if (!section.token) {
      throw new Error(`No token found for rclone remote [${this.remote}]`);
    }
    return JSON.parse(section.token);
  }

  private parseSection(config: string, sectionName: string): Record<string, string> {
    const lines = config.split('\n');
    const result: Record<string, string> = {};
    let inSection = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === `[${sectionName}]`) {
        inSection = true;
        continue;
      }
      if (trimmed.startsWith('[') && inSection) {
        break;
      }
      if (inSection && trimmed.includes('=')) {
        const eqIndex = trimmed.indexOf('=');
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        result[key] = value;
      }
    }
    return result;
  }

  private isExpired(): boolean {
    const expiry = new Date(this.token.expiry).getTime();
    return Date.now() > expiry - EXPIRY_BUFFER_MS;
  }

  private async refresh(): Promise<void> {
    const resp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: customOAuth?.clientId || RCLONE_CLIENT_ID,
        client_secret: customOAuth?.clientSecret || RCLONE_CLIENT_SECRET,
        refresh_token: this.token.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Token refresh failed (${resp.status}): ${body}`);
    }

    const data = await resp.json();
    this.token.access_token = data.access_token;
    this.token.expiry = new Date(Date.now() + data.expires_in * 1000).toISOString();

    // Write back to rclone.conf so rclone stays in sync
    this.writeTokenToConfig();
  }

  private writeTokenToConfig(): void {
    try {
      let config = readFileSync(this.configPath, 'utf-8');
      const tokenJson = JSON.stringify(this.token);
      // Replace the token line in the config
      const lines = config.split('\n');
      let inSection = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === `[${this.remote}]`) {
          inSection = true;
          continue;
        }
        if (lines[i].trim().startsWith('[') && inSection) break;
        if (inSection && lines[i].trim().startsWith('token =')) {
          lines[i] = `token = ${tokenJson}`;
          break;
        }
      }
      writeFileSync(this.configPath, lines.join('\n'));
    } catch {
      // Non-critical — token is cached in memory
    }
  }
}
