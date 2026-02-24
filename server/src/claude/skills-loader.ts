import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { CONFIG } from '../config.js';

export interface SkillDef {
  name: string;
  description: string;
  type: 'command' | 'skill';
  content: string; // full markdown (including frontmatter-stripped body)
  references: Array<{ name: string; content: string }>;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      meta[key] = value;
    }
  }
  return { meta, body: match[2] };
}

function loadReferences(dir: string): Array<{ name: string; content: string }> {
  const refsDir = join(dir, 'references');
  if (!existsSync(refsDir)) return [];

  return readdirSync(refsDir)
    .filter((f) => f.endsWith('.md') || f.endsWith('.sql'))
    .map((f) => ({
      name: f,
      content: readFileSync(join(refsDir, f), 'utf-8'),
    }));
}

function loadCommands(): SkillDef[] {
  const commandsDir = join(CONFIG.pmSkillsPath, 'commands');
  if (!existsSync(commandsDir)) return [];

  return readdirSync(commandsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const raw = readFileSync(join(commandsDir, f), 'utf-8');
      const { meta, body } = parseFrontmatter(raw);
      return {
        name: `/${basename(f, '.md')}`,
        description: meta.description || '',
        type: 'command' as const,
        content: body,
        references: [],
      };
    });
}

function loadSkills(): SkillDef[] {
  const skillsDir = join(CONFIG.pmSkillsPath, 'skills');
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir)
    .filter((d) => {
      const p = join(skillsDir, d);
      return statSync(p).isDirectory() && existsSync(join(p, 'SKILL.md'));
    })
    .map((d) => {
      const dir = join(skillsDir, d);
      const raw = readFileSync(join(dir, 'SKILL.md'), 'utf-8');
      const { meta, body } = parseFrontmatter(raw);
      return {
        name: d,
        description: meta.description || '',
        type: 'skill' as const,
        content: body,
        references: loadReferences(dir),
      };
    });
}

function loadKnowledge(): string {
  const knowledgeDir = join(CONFIG.pmSkillsPath, 'knowledge');
  if (!existsSync(knowledgeDir)) return '';

  const sections: string[] = [];
  for (const category of readdirSync(knowledgeDir)) {
    const catDir = join(knowledgeDir, category);
    if (!statSync(catDir).isDirectory()) continue;

    for (const file of readdirSync(catDir).filter((f) => f.endsWith('.md'))) {
      const content = readFileSync(join(catDir, file), 'utf-8');
      sections.push(`## ${category}/${file}\n\n${content}`);
    }
  }
  return sections.join('\n\n---\n\n');
}

// Cache everything at startup
let _commands: SkillDef[] | null = null;
let _skills: SkillDef[] | null = null;
let _knowledge: string | null = null;

export function getCommands(): SkillDef[] {
  if (!_commands) _commands = loadCommands();
  return _commands;
}

export function getSkills(): SkillDef[] {
  if (!_skills) _skills = loadSkills();
  return _skills;
}

export function getKnowledge(): string {
  if (!_knowledge) _knowledge = loadKnowledge();
  return _knowledge;
}

export function getAllSkillDefs(): SkillDef[] {
  return [...getCommands(), ...getSkills()];
}

export function findSkillOrCommand(name: string): SkillDef | undefined {
  const normalized = name.startsWith('/') ? name : `/${name}`;
  // Check commands first
  const cmd = getCommands().find((c) => c.name === normalized);
  if (cmd) return cmd;
  // Check skills by name
  const skillName = normalized.slice(1); // remove /
  return getSkills().find((s) => s.name === skillName);
}

/**
 * Build the full context for a skill/command invocation.
 * Includes the command/skill body + all its reference files.
 */
export function buildSkillContext(skill: SkillDef): string {
  let ctx = `# Skill: ${skill.name}\n\n${skill.content}`;

  if (skill.references.length > 0) {
    ctx += '\n\n---\n\n# Reference Materials\n\n';
    for (const ref of skill.references) {
      ctx += `## ${ref.name}\n\n${ref.content}\n\n---\n\n`;
    }
  }

  return ctx;
}
