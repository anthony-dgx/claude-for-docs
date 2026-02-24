import { homedir } from 'os';
import { join } from 'path';

export const CONFIG = {
  port: parseInt(process.env.DOCPAT_PORT || '3456'),
  rcloneConfigPath: join(homedir(), '.config/rclone/rclone.conf'),
  rcloneRemote: 'gdrive',
  personalOsPath: join(homedir(), 'Desktop/Lab/personal_os'),
  pmSkillsPath: join(homedir(), '.claude/plugins/cache/pm-skills/pm/692a95be0025'),
  model: 'claude-sonnet-4-6' as const,
  maxBudgetUsd: 1.0,
  maxTurns: 20,
} as const;
