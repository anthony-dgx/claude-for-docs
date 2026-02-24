# Claude for Docs

A Chrome extension that adds a Claude-powered side panel to Google Docs. It can read your documents, answer comments, draft replies, edit content, and run PM skills — all from a chat interface next to your doc.

## What it does

- **Read docs** — Claude reads the full document content and structure
- **Analyze comments** — Lists all comments, groups by theme, highlights what needs your attention
- **Answer comments** — Drafts and posts replies directly in Google Docs
- **Edit documents** — Inserts, replaces, or appends text in the doc
- **PM skills** — Type `/` to access built-in skills: write brief, stakeholder update, competitive analysis, roadmap extraction, polish writing, and more
- **Knowledge base** — Claude can search your local `personal_os/` folder for context (synced Drive docs, briefs, colleague notes)

## How it works

```
Chrome Extension (side panel)     Local Server (localhost:3456)
┌──────────────────────┐         ┌─────────────────────────────────┐
│                      │         │                                 │
│ Detects Google Doc   │   ws    │ Reads Google Drive OAuth token  │
│ from the active tab  │◄───────►│ from rclone config              │
│                      │         │                                 │
│ Chat UI with         │         │ Calls Google Drive & Docs APIs  │
│ streaming responses  │         │ (read/write docs & comments)    │
│                      │         │                                 │
│ / commands for       │         │ Claude Agent SDK                │
│ PM skills            │         │ (with MCP tools for Google Docs)│
└──────────────────────┘         └─────────────────────────────────┘
```

**No Google Cloud OAuth app needed.** The server reuses the OAuth token from [rclone](https://rclone.org/), which you configure once with your Google account.

### Why rclone?

To call the Google Drive and Docs APIs, you need an OAuth token. Normally, that means registering an OAuth client in Google Cloud Console — you can go faster by just using rclone.

rclone ships its own built-in OAuth client ID (shared by all rclone users). When you run `rclone config`, it handles the entire OAuth flow — browser login, consent, token exchange — and stores the resulting access + refresh tokens locally in `~/.config/rclone/rclone.conf`.

Our server reads that token file, refreshes it automatically when it expires, and uses it to call Google APIs. No Google Cloud project, no OAuth app registration, no IT approval needed. Each team member just runs `rclone config` once with their own Google account.

## Prerequisites

- **Node.js** 22+ (`node --version`)
- **rclone** (`brew install rclone`)
- **Anthropic API key** from [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- **Chrome** (or Chromium-based browser)

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/DataDog/claude-for-docs.git
cd claude-for-docs
```

### 2. Configure rclone (one-time)

This gives the server access to your Google Drive. Run:

```bash
rclone config
```

Follow the prompts:
1. Press `n` for new remote
2. Name it `gdrive`
3. Type `drive` for storage type
4. Leave `client_id` and `client_secret` blank (press Enter)
5. Scope: type `drive` (full access — needed to read/write docs and comments)
6. Leave `service_account_file` blank
7. Say `n` to advanced config
8. Say `y` to auto config — your browser will open for Google login
9. Authorize rclone to access your Google Drive
10. Say `n` to shared drive (unless your docs are on a shared drive)
11. Confirm with `y`, then `q` to quit

**If you already have rclone configured with `drive.readonly` scope**, upgrade it:

```bash
rclone config update gdrive --drive-scope drive
rclone config reconnect gdrive:
```

### 3. Install server dependencies

```bash
cd server
npm install
```

> **Note for Datadog employees:** If `npm install` is blocked by SCFW (supply chain firewall), use the npm binary directly:
> ```bash
> /Users/$USER/.nvm/versions/node/$(node -v)/bin/npm install
> ```

### 4. Add your own skills (optional)

DocPat can load custom slash commands and skills from your local filesystem. This is how you get `/write-brief`, `/release-note`, `/competitive`, and all the other PM skills — they're just markdown files in a folder.

**Create `~/.docpat.json`** in your home directory:

```json
{
  "skillsPaths": [
    "~/my-docpat-skills"
  ]
}
```

You can list multiple directories — DocPat merges them all. For example, your personal skills plus a shared team folder:

```json
{
  "skillsPaths": [
    "~/my-docpat-skills",
    "/path/to/team-shared-skills"
  ]
}
```

**Already using Claude Code PM skills?** Point directly to your plugin cache:

```json
{
  "skillsPaths": [
    "~/.claude/plugins/cache/pm-skills/pm/692a95be0025"
  ]
}
```

#### Skills directory structure

Each path in `skillsPaths` should follow this layout:

```
my-docpat-skills/
├── commands/                # Slash commands — one .md file each
│   ├── summarize.md         # → /summarize
│   ├── write-brief.md       # → /write-brief
│   └── release-note.md      # → /release-note
│
├── skills/                  # Multi-file skills — each in its own folder
│   └── competitive-analysis/
│       ├── SKILL.md          # Main skill prompt (required)
│       └── references/       # Supporting files loaded with the skill
│           ├── template.md
│           └── examples.sql
│
└── knowledge/               # Context files injected into every conversation
    └── domain/
        └── glossary.md
```

**Commands** are simple: one markdown file per slash command. The filename becomes the command name.

**Skills** are richer: each gets a folder with a `SKILL.md` and optional `references/` directory for templates, examples, or data files.

**Knowledge** files are always included as background context — useful for domain glossaries, team conventions, or product specs.

#### Writing a command

A command file is a markdown file with optional YAML frontmatter:

```markdown
---
description: Write a product brief from the document
---

Read the current document and write a structured product brief with:
- Problem statement
- User stories
- Requirements (P0/P1/P2)
- Success metrics
```

The `description` appears in the `/` menu in the side panel. The body is sent to Claude as the prompt.

#### Alternative: env var

You can also set `DOCPAT_SKILLS_PATH` as a comma-separated environment variable:

```bash
DOCPAT_SKILLS_PATH=~/my-skills,/team/skills npm run dev
```

### 5. Start the server

```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here npm run dev
```

You should see:
```
DocPat server running on http://localhost:3456
WebSocket available at ws://localhost:3456
API key: set
```

### 6. Load the Chrome extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repo
5. The DocPat icon (purple dog) appears in your toolbar

### 7. Use it

1. Open any Google Doc in Chrome
2. Click the DocPat icon — the side panel opens
3. The doc is auto-detected from the URL. If not, paste the Google Doc URL in the chat
4. Start chatting! Try:
   - `summarize this doc`
   - `list all open comments`
   - `draft a reply to Doug's comment about cost governance`
   - `add a comment on the "Executive Summary" section suggesting we add metrics`
5. Type `/` to see available PM skills

## Built-in skills

These four commands are always available, even without any skills directory configured:

| Command | Description |
|---------|-------------|
| `/summarize` | Summarize the doc and open comments |
| `/comments` | Analyze and group all open comments |
| `/reply-comments` | Draft replies to all open comments |
| `/polish` | Suggest clarity and conciseness improvements |

Any additional skills you add via `~/.docpat.json` will show up alongside these when you type `/` in the chat.

## Project structure

```
claude-for-docs/
├── server/                          # Local Node.js server
│   ├── src/
│   │   ├── index.ts                 # HTTP + WebSocket server
│   │   ├── config.ts                # Paths and settings
│   │   ├── google/
│   │   │   ├── token-manager.ts     # Reads/refreshes rclone OAuth token
│   │   │   ├── drive-api.ts         # Google Drive API v3 (files, comments)
│   │   │   └── docs-api.ts          # Google Docs API v1 (structured edits)
│   │   ├── claude/
│   │   │   ├── agent.ts             # Claude Agent SDK orchestration
│   │   │   ├── gdocs-mcp-server.ts  # MCP tools for Google Docs (10 tools)
│   │   │   └── system-prompt.ts     # Context prompt for the agent
│   │   └── ws/
│   │       └── handler.ts           # WebSocket message routing
│   ├── package.json
│   └── tsconfig.json
│
├── extension/                       # Chrome extension (Manifest v3)
│   ├── manifest.json
│   ├── background.js                # Service worker
│   ├── content.js                   # Detects Google Doc pages
│   ├── sidepanel.html               # Chat UI
│   ├── sidepanel.js                 # WebSocket client + rendering
│   ├── sidepanel.css                # Dark theme styles
│   └── icons/
│
└── .env.example
```

## MCP tools (what Claude can do)

The server exposes 10 MCP tools to Claude:

| Tool | Description |
|------|-------------|
| `get_doc_content` | Read the full text of the document |
| `get_doc_structure` | Get structured JSON (headings, paragraphs, tables) |
| `get_doc_metadata` | Get title, owner, last modified date |
| `list_comments` | List all comments with replies and quoted text |
| `add_comment` | Post a new comment (anchored to specific text) |
| `reply_to_comment` | Reply to an existing comment |
| `resolve_comment` | Mark a comment as resolved |
| `insert_text` | Insert text at a specific position |
| `replace_text` | Find and replace text |
| `append_text` | Add text to the end of the document |

## Troubleshooting

**"No doc detected"**
Refresh the Google Docs page after loading the extension, or paste the doc URL directly in the chat.

**"API key: NOT SET"**
Make sure you pass the key when starting the server: `ANTHROPIC_API_KEY=sk-ant-... npm run dev`

**Token refresh errors**
Run `rclone lsf gdrive:` to verify rclone can access your Drive. If it fails, re-run `rclone config reconnect gdrive:`.

**npm install blocked by SCFW**
Use the npm binary directly (see step 3 above).

**Side panel won't open**
Make sure you're on a `docs.google.com/document/` page. The extension only activates on Google Docs.
