import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';

interface UserConfig {
  skillsPaths?: string[];
  personalOsPath?: string;
  oauth?: {
    clientId?: string;
    clientSecret?: string;
  };
}

function loadUserConfig(): UserConfig {
  const configPath = join(homedir(), '.docpat.json');
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    console.warn(`[config] Failed to parse ${configPath}, using defaults`);
    return {};
  }
}

const userConfig = loadUserConfig();

function resolveSkillsPaths(): string[] {
  // 1. User config file (~/.docpat.json)
  if (userConfig.skillsPaths && userConfig.skillsPaths.length > 0) {
    return userConfig.skillsPaths.map((p) =>
      p.startsWith('~') ? join(homedir(), p.slice(1)) : p
    );
  }
  // 2. Environment variable (comma-separated)
  if (process.env.DOCPAT_SKILLS_PATH) {
    return process.env.DOCPAT_SKILLS_PATH.split(',').map((p) => p.trim());
  }
  // 3. No skills configured
  return [];
}

export const CONFIG = {
  port: parseInt(process.env.DOCPAT_PORT || '3456'),
  rcloneConfigPath: join(homedir(), '.config/rclone/rclone.conf'),
  rcloneRemote: 'gdrive',
  personalOsPath: userConfig.personalOsPath
    ? (userConfig.personalOsPath.startsWith('~')
      ? join(homedir(), userConfig.personalOsPath.slice(1))
      : userConfig.personalOsPath)
    : join(homedir(), 'Desktop/Lab/personal_os'),
  skillsPaths: resolveSkillsPaths(),
  oauth: {
    clientId: userConfig.oauth?.clientId || '',
    clientSecret: userConfig.oauth?.clientSecret || '',
  },
  model: 'claude-sonnet-4-6' as const,
  maxBudgetUsd: 1.0,
  maxTurns: 20,
} as const;
