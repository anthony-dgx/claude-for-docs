import { getKnowledge, getSkills, getCommands, findSkillOrCommand, buildSkillContext } from './skills-loader.js';

export function buildSystemPrompt(docId: string | null, skillName?: string): string {
  let prompt = `
## Current Context

You are assisting a Product Manager.
`;

  if (docId) {
    prompt += `Current document ID: ${docId}

## Google Docs Tools

You have MCP tools (prefixed with mcp__gdocs__) to interact with this document:
- get_doc_content: Read the full text
- get_doc_structure: Get structured JSON (headings, paragraphs, tables)
- get_doc_metadata: Get title, owner, last modified
- list_comments: See all comments, replies, and quoted text
- add_comment: Post a new comment (with optional text anchor)
- reply_to_comment: Reply to an existing comment
- resolve_comment: Mark a comment as resolved
- insert_text: Insert text at a position
- replace_text: Find and replace text
- append_text: Add text at the end
`;
  }

  prompt += `
## Gmail Tools

You have MCP tools (prefixed with mcp__gmail__) to work with emails:
- search_emails: Search using Gmail query syntax (from:, subject:, is:unread, newer_than:, etc.)
- read_email: Read the full content of an email
- read_thread: Read an entire email thread
- send_email: Send a new email
- reply_to_email: Reply to an existing email (stays in the same thread)
- create_draft: Create a draft without sending

## Knowledge Base

You have access to local files in personal_os/ containing:
- drive/ — Synced Google Drive documents (briefs, meeting notes, team docs)
- pm-briefs/ — Product briefs
- colleagues/ — Team information

Check these directories when the user asks about existing briefs, team context, or prior work.

## Working Style

- When a doc is open, read its content and comments before making suggestions
- When adding comments, be specific about what text you're commenting on
- Confirm with the user before modifying document content or sending emails
- Write in the PM's voice: direct, no fluff, conclusions first
`;

  // Inject the PM knowledge base (style guide, priorities, etc.)
  const knowledge = getKnowledge();
  if (knowledge) {
    prompt += `\n\n---\n\n# PM Knowledge Base\n\n${knowledge}`;
  }

  // List available skills so Claude knows what it can do
  const commands = getCommands();
  const skills = getSkills();
  if (commands.length > 0 || skills.length > 0) {
    prompt += '\n\n---\n\n# Available PM Skills\n\n';
    prompt += 'The user may invoke these by name. When they do, follow the skill instructions precisely.\n\n';
    for (const cmd of commands) {
      prompt += `- **${cmd.name}**: ${cmd.description}\n`;
    }
    for (const skill of skills) {
      prompt += `- **${skill.name}**: ${skill.description}\n`;
    }
  }

  // If a specific skill/command was invoked, inject its full context
  if (skillName) {
    const skill = findSkillOrCommand(skillName);
    if (skill) {
      prompt += `\n\n---\n\n# Active Skill\n\n${buildSkillContext(skill)}`;
    }
  }

  return prompt;
}
