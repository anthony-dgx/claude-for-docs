// Side panel: chat UI with WebSocket client
const SERVER_URL = 'ws://localhost:3456';
const RECONNECT_DELAY = 3000;

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');
const statusEl = document.getElementById('status');
const docTitleEl = document.getElementById('doc-title');
const toolIndicatorEl = document.getElementById('tool-indicator');
const costEl = document.getElementById('cost');

let ws = null;
let currentDocId = null;
let currentStreamEl = null;
let currentStreamText = '';
let totalCost = 0;
let isWaiting = false;

// ── WebSocket ──

function connect() {
  setStatus('connecting');
  ws = new WebSocket(SERVER_URL);

  ws.onopen = () => {
    setStatus('connected');
    if (currentDocId) {
      ws.send(JSON.stringify({ type: 'init', docId: currentDocId }));
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleServerMessage(msg);
  };

  ws.onclose = () => {
    setStatus('disconnected');
    ws = null;
    setTimeout(connect, RECONNECT_DELAY);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'ready':
      break;

    case 'stream':
      if (!currentStreamEl) {
        currentStreamEl = addMessage('assistant', '');
        currentStreamText = '';
      }
      currentStreamText += msg.text;
      currentStreamEl.innerHTML = renderMarkdown(currentStreamText);
      scrollToBottom();
      break;

    case 'tool_use':
      showToolIndicator(formatToolName(msg.toolName));
      break;

    case 'tool_result':
      hideToolIndicator();
      break;

    case 'done':
      hideToolIndicator();
      currentStreamEl = null;
      currentStreamText = '';
      totalCost += msg.cost || 0;
      costEl.textContent = `$${totalCost.toFixed(4)}`;
      setWaiting(false);
      break;

    case 'error':
      hideToolIndicator();
      addMessage('error', msg.message);
      currentStreamEl = null;
      currentStreamText = '';
      setWaiting(false);
      break;
  }
}

// ── UI ──

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = `message message-${role}`;
  if (role === 'assistant') {
    el.innerHTML = renderMarkdown(text);
  } else {
    el.textContent = text;
  }
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(status) {
  statusEl.className = `status status-${status}`;
  statusEl.title = status.charAt(0).toUpperCase() + status.slice(1);
}

function setWaiting(waiting) {
  isWaiting = waiting;
  sendBtn.disabled = waiting;
  inputEl.disabled = waiting;
  if (!waiting) inputEl.focus();
}

function showToolIndicator(label) {
  toolIndicatorEl.textContent = label;
  toolIndicatorEl.classList.remove('hidden');
}

function hideToolIndicator() {
  toolIndicatorEl.classList.add('hidden');
}

function formatToolName(name) {
  const labels = {
    'mcp__gdocs__get_doc_content': 'Reading document...',
    'mcp__gdocs__get_doc_structure': 'Analyzing structure...',
    'mcp__gdocs__get_doc_metadata': 'Getting metadata...',
    'mcp__gdocs__list_comments': 'Reading comments...',
    'mcp__gdocs__add_comment': 'Adding comment...',
    'mcp__gdocs__reply_to_comment': 'Posting reply...',
    'mcp__gdocs__resolve_comment': 'Resolving comment...',
    'mcp__gdocs__insert_text': 'Inserting text...',
    'mcp__gdocs__replace_text': 'Replacing text...',
    'mcp__gdocs__append_text': 'Appending text...',
    Read: 'Reading file...',
    Glob: 'Searching files...',
    Grep: 'Searching content...',
    WebSearch: 'Searching the web...',
    WebFetch: 'Fetching page...',
  };
  return labels[name] || `Running ${name}...`;
}

// ── Markdown (lightweight) ──

function renderMarkdown(text) {
  return text
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Headers
    .replace(/^### (.+)$/gm, '<strong>$1</strong>')
    .replace(/^## (.+)$/gm, '<strong>$1</strong>')
    .replace(/^# (.+)$/gm, '<strong style="font-size:1.1em">$1</strong>')
    // Lists
    .replace(/^- (.+)$/gm, '  \u2022 $1')
    // Line breaks
    .replace(/\n/g, '<br>');
}

// ── Skills ──

const SKILLS = [
  { cmd: '/summarize', label: 'Summarize doc', desc: 'Summarize the document content and open comments', prompt: 'Read this document and give me a concise summary. Then list the open comments with who said what.' },
  { cmd: '/comments', label: 'Analyze comments', desc: 'List and analyze all open comments', prompt: 'List all open comments on this document. Group them by theme and highlight any that need my response.' },
  { cmd: '/write-brief', label: 'Write brief', desc: 'Write a product brief from this document', prompt: 'Read this document and write a structured product brief based on its content. Include problem statement, user stories, requirements, and success metrics.' },
  { cmd: '/polish', label: 'Polish writing', desc: 'Rewrite for clarity and conciseness', prompt: 'Read this document and suggest improvements for clarity and conciseness. Be specific about which sections to change and how.' },
  { cmd: '/stakeholder-update', label: 'Stakeholder update', desc: 'Draft a stakeholder update from this doc', prompt: 'Read this document and draft a concise stakeholder update email based on its content. Include key decisions, progress, and next steps.' },
  { cmd: '/reply-comments', label: 'Draft replies', desc: 'Draft replies to all open comments', prompt: 'Read the document and all open comments. Draft thoughtful replies to each comment that needs a response from me.' },
  { cmd: '/competitive', label: 'Competitive analysis', desc: 'Create a competitive brief', prompt: 'Read this document and create a competitive analysis brief based on its content. Include feature comparisons and strategic implications.' },
  { cmd: '/roadmap', label: 'Roadmap update', desc: 'Extract roadmap items from this doc', prompt: 'Read this document and extract potential roadmap items. Prioritize them using RICE scoring and suggest a Now/Next/Later breakdown.' },
  { cmd: '/release-note', label: 'Release note', desc: 'Write a customer-facing release note', prompt: 'Read this document and write a concise, customer-facing release note based on its content.' },
  { cmd: '/research', label: 'Synthesize research', desc: 'Synthesize research insights from this doc', prompt: 'Read this document and synthesize the research findings into structured insights. Identify key themes, user needs, and opportunity areas.' },
];

const skillsMenuEl = document.getElementById('skills-menu');
let activeSkillIndex = -1;

function showSkillsMenu(filter = '') {
  const filtered = SKILLS.filter(s =>
    s.cmd.includes(filter.toLowerCase()) || s.label.toLowerCase().includes(filter.toLowerCase())
  );

  if (filtered.length === 0) {
    hideSkillsMenu();
    return;
  }

  activeSkillIndex = 0;
  skillsMenuEl.innerHTML = filtered.map((s, i) =>
    `<div class="skill-item${i === 0 ? ' active' : ''}" data-index="${i}">
      <span class="skill-name">${s.cmd}</span>
      <span class="skill-desc">${s.desc}</span>
    </div>`
  ).join('');

  skillsMenuEl.classList.remove('hidden');

  // Click handlers
  skillsMenuEl.querySelectorAll('.skill-item').forEach((el, i) => {
    el.addEventListener('click', () => selectSkill(filtered[i]));
    el.addEventListener('mouseenter', () => {
      activeSkillIndex = i;
      highlightSkill();
    });
  });
}

function hideSkillsMenu() {
  skillsMenuEl.classList.add('hidden');
  activeSkillIndex = -1;
}

function highlightSkill() {
  skillsMenuEl.querySelectorAll('.skill-item').forEach((el, i) => {
    el.classList.toggle('active', i === activeSkillIndex);
  });
}

function selectSkill(skill) {
  inputEl.value = skill.prompt;
  hideSkillsMenu();
  autoResize();
  inputEl.focus();
}

// ── Doc ID helpers ──

function extractDocId(text) {
  const match = text.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function setDocId(docId, title) {
  currentDocId = docId;
  docTitleEl.textContent = title || docId.substring(0, 20) + '...';
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'init', docId }));
  }
}

// ── Send message ──

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || isWaiting || !ws || ws.readyState !== WebSocket.OPEN) return;

  // Auto-detect doc ID from pasted URLs
  if (!currentDocId) {
    const docId = extractDocId(text);
    if (docId) {
      setDocId(docId);
    }
  }

  addMessage('user', text);
  inputEl.value = '';
  autoResize();
  setWaiting(true);

  ws.send(JSON.stringify({
    type: 'chat',
    docId: currentDocId,
    message: text,
  }));
}

// ── Input handling ──

inputEl.addEventListener('keydown', (e) => {
  // Skills menu navigation
  if (!skillsMenuEl.classList.contains('hidden')) {
    const items = skillsMenuEl.querySelectorAll('.skill-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeSkillIndex = Math.min(activeSkillIndex + 1, items.length - 1);
      highlightSkill();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeSkillIndex = Math.max(activeSkillIndex - 1, 0);
      highlightSkill();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const filter = inputEl.value.slice(1).toLowerCase();
      const filtered = SKILLS.filter(s =>
        s.cmd.includes(filter) || s.label.toLowerCase().includes(filter)
      );
      if (filtered[activeSkillIndex]) {
        selectSkill(filtered[activeSkillIndex]);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideSkillsMenu();
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

inputEl.addEventListener('input', () => {
  autoResize();
  const text = inputEl.value;
  if (text.startsWith('/') && !text.includes(' ')) {
    showSkillsMenu(text.slice(1));
  } else {
    hideSkillsMenu();
  }
});

sendBtn.addEventListener('click', sendMessage);

function autoResize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
}

// ── Init ──

async function init() {
  // Try 1: ask background for cached doc info
  chrome.runtime.sendMessage({ type: 'GET_CURRENT_DOC' }, (doc) => {
    if (doc && doc.docId) {
      setDocId(doc.docId, doc.docTitle);
    }
  });

  // Try 2: read the active tab URL directly
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const docId = extractDocId(tab.url);
      if (docId && !currentDocId) {
        const title = tab.title?.replace(/ - Google Docs$/, '') || '';
        setDocId(docId, title);
      }
    }
  } catch {
    // tabs API may not be available in all contexts
  }

  if (!currentDocId) {
    docTitleEl.textContent = 'Paste a Google Doc URL to start';
  }

  connect();
}

init();
